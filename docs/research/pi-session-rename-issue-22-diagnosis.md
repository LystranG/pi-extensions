# pi-session-rename issue #22 诊断报告

> 状态：**已复现；A/B/C/D 已全部实现（见 §8 开头的实现状态）**。§1–§7 是定位与证据，§8 是设计
> 对象：`plugins/pi-session-rename`（仓库 `0.2.2` / 已安装 `0.2.3`）
> 关联：LystranG/pi-extensions#22
> 诊断手段：源码追踪 + 本机 mock provider 抓包（不使用真实网络），实验产物在 `/tmp/pi-rename-diag/`

## 1. 摘要

issue #22 描述了 1 个缺陷，实际存在 **4 个互相独立的缺陷**，其中 2 个 issue 未覆盖。issue 的标题结论（缺 `x-opencode-session`）正确，但「第二个根因」的机制判断不成立，修复手段也需要修正。

| # | 现象 | 根因 | 影响面 |
| --- | --- | --- | --- |
| 1 | opencode / opencode-go 下完全不命名，报 `400 MissingSessionID` | 扩展经 `modelRegistry.complete()` 发起的请求不带 opencode 路由头；`transformHeaders` 是唯一跨版本可用的传法 | 所有 opencode 系模型 |
| 2 | header 修好后仍然静默不命名 | `maxTokens: 80` 被强制开启的思考吃光 → 无 text part → 静默返回；`reasoning` 参数被 pi-ai 忽略，没有任何办法关闭这类模型的思考 | `thinkingLevelMap.off === null` 的模型（issue 列出的那批） |
| 3 | 关闭会话后 `pi -r` / `pi -c` 恢复，会**再次**触发重命名 | 唯一的闸门是 `getSessionName() !== undefined`，而 `session_start` 会把状态全部重置；从未成功命名过的会话在恢复后被重新命名 | 首轮命名失败/被中断过的会话 |
| 4 | 重命名尝试次数不设上限 | `agent_settled` 在 turn 失败时重置 `attempted`/`candidate`，第 3、4…N 条用户消息都能再次触发 | 首轮失败的会话 |

## 2. 复现环境与手段

版本矩阵（插件在不同解析路径下会用到不同的 pi-ai）：

| 位置 | pi-ai | pi-coding-agent |
| --- | --- | --- |
| 插件 devDeps（`plugins/pi-session-rename/node_modules`） | 0.84.2 | 0.84.2 |
| 已安装插件实际解析（`~/.pi/agent/npm/node_modules/@earendil-works`） | 0.85.0 | — |
| 真实运行 `pi --version` → 0.87.1 | 0.87.1 | 0.87.1 |

实验手段（全部在 `/tmp/pi-rename-diag/`，**不在仓库内**；所有 HTTP 请求指向本机 `Bun.serve`，不使用真实 provider）：

| 文件 | 作用 |
| --- | --- |
| `check1.ts` | 抓 opencode 模型 outgoing header，对比 plain / `sessionId` / `transformHeaders` 三种形状在三个 pi-ai 版本下的差异 |
| `check2.ts` | 用 fake `complete()` 直接驱动仓库的 `src/title.ts:generateTitle`，观察 `stopReason` 为 `length` / 空正文时的返回值 |
| `check3.ts` | 直接驱动仓库的 `src/controller.ts`，脚本化「恢复会话」的事件序列，统计是否再次发起命名 |
| `check5.ts` | 抓 outgoing **body**，对比 `complete` / `completeSimple` 对 `reasoning` 的处理 |
| `check6.ts` | 端到端：真实 `generateTitle` → 真实 `models.complete` → 抓包（即 `src/index.ts:14-15` 的真实调用形状） |
| `mock-provider.ts` + `runpi.sh` | 让真实 `pi` 进程跑在本地 OpenAI 兼容 mock 上，验证 `session_start` 的 `reason` 与 `session_info` 的实际落盘 |

## 3. 缺陷 1：opencode 路由头缺失

请求链路：

```
src/index.ts:14-15   modelRegistry.complete(requestModel, context, options)
  → dist/core/model-registry.js:65-67   complete() { return this.runtime.complete(...) }
  → dist/core/model-runtime.js:458      complete() { return this.stream(...).result() }
  → dist/core/model-runtime.js:452-456  stream()  { provider.stream(model, ctx, prepared.options) }
  → dist/core/model-runtime.js:422-451  prepareRequest()：只应用调用方自己的 transformHeaders，从不注入归属头
```

主循环的头来自另一条路径：

- `dist/core/sdk.js:194`（0.84.2）/ `:190`（0.87.1）`mergeProviderAttributionHeaders(model, settingsManager, options?.sessionId, requestHeaders)`
- `dist/core/provider-attribution.js:50-59` `getSessionHeaders()`：仅当 `provider ∈ {opencode, opencode-go}` 或 `baseUrl` host 为 `opencode.ai` 时返回 `{"x-opencode-session": sessionId, "x-opencode-client": "pi"}`（两个头一起返回）

两条路径互不相干，这就是扩展请求缺头的原因。

跨版本差异（issue 未说明，但决定了修复形状）：

- pi-ai `0.87.1`：`dist/providers/opencode-headers.js` 的 `withSessionHeader()` 读的是 `options.sessionId`；`providers/opencode.js`、`opencode-go.js` 用它包装了各个 api。
- pi-ai `0.84.2` 与 `0.85.0`：**没有这个文件**，opencode provider 直接裸调 api，任何选项都不会产生该头。

`check1.ts` 实测（opencode-go 目录模型 `deepseek-v4-flash`，baseUrl 指向本机 mock）：

| 传参形状 | pi-ai 0.84.2 | 0.85.0 | 0.87.1 |
| --- | --- | --- | --- |
| 不传（现状） | `{}` | `{}` | `{}` |
| `sessionId` | `{}` | `{}` | `{"x-opencode-session":"sess-123"}`（无 `x-opencode-client`） |
| `transformHeaders` | 两个头都到 | 两个头都到 | 两个头都到 |

**结论**：必须用 `transformHeaders` 并自行复制 opencode 的 gate；`options.sessionId` 在 0.84.2/0.85.0 上是静默无效，在 0.87.1 上也还缺 `x-opencode-client`。

## 4. 缺陷 2：`maxTokens: 80` 被思考吃光 + 失败静默

### 4.1 纠正：`reasoning` 选项根本没有生效

修复前 `src/title.ts:125,132-136` 把 `getTitleThinkingLevel()` 的结果作为 `reasoning` 放进请求选项（本节行号对应修复前的版本，相关代码已由 D 删除）：

```ts
const reasoning = getTitleThinkingLevel(model);
...
{ signal, maxTokens: 80, ...(reasoning ? { reasoning } : {}) }
```

但 `reasoning` 属于 `SimpleStreamOptions`（pi-ai `dist/types.d.ts:211-212`），而这一步走的是**非 simple** 路径：

- `ModelRegistry.complete` 的选项类型是 `ModelsApiStreamOptions<TApi> = ApiStreamOptions<TApi> & ModelsRequestTransforms`（pi-ai `dist/types.d.ts:179`），是**每个 api 各自的选项类型**（例如 `reasoningEffort`、`reasoningSummary`）。
- pi-ai 只在 `streamSimple` 里把 `reasoning` 映射成 effort：`dist/api/openai-completions.js:472-473`、`dist/api/openai-responses.js:152-153`
  `const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined; const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;`
- provider 的 `stream()` 读的是 `options.reasoningEffort`（`openai-completions.js:477`、`openai-responses.js:156`、`:238-256`），不读 `options.reasoning`。
- 类型检查抓不到，是因为 `generateTitle` 的 `complete` 回调选项类型是插件**自己声明**的（`src/title.ts` 的 options 形参），不是 pi-ai 的类型。

`check6.ts` 端到端实测（真实 `generateTitle` → 真实 `models.complete`，抓 outgoing body）：

```
### deepseek-v4-flash  levels=[off,high,max]  thinkingLevelMap.off=undefined
  plugin getTitleThinkingLevel() = "high"
  wire body = {"thinking":{"type":"disabled"},"max_tokens":80}

### kimi-k3           levels=[max]          thinkingLevelMap.off=null
  plugin getTitleThinkingLevel() = "max"
  wire body = {"max_tokens":80}

### glm-5.2           levels=[high,max]      thinkingLevelMap.off=null
  plugin getTitleThinkingLevel() = "high"
  wire body = {"max_tokens":80}
```

同一实验在 pi-ai `0.85.0`（已安装插件的实际解析目标）与 `0.87.1`（真实运行时）上结果一致：算出的等级分别是 `low` / `max` / `high`，请求体里同样没有 `reasoning` / `reasoning_effort`，`off !== null` 的模型同样由 pi-ai 自行下发 `thinking:{type:"disabled"}`。（三个版本的 opencode 目录略有差异，0.84.2 的 `deepseek-v4-flash` 是 `[off,high,max]`、0.85.0/0.87.1 是 `[off,low,high,max]`，不影响结论。）

计算出来的 `"high"` / `"max"` 完全没有出现在请求体里。`check5.ts` 的对照也一致：`complete {maxTokens:80}` 与 `complete {maxTokens:80,reasoning:"high"}` 的 body 完全相同，而 `completeSimple {reasoning:"high"}` 反而会加上 `reasoning_effort` 并把思考**打开**。

### 4.2 真正会炸的是哪些模型

pi-ai 在 `stream` 路径上的实际行为（`dist/api/openai-responses.js:238-256`，`openai-completions.js` 的 thinkingFormat 分支同理）：

- `thinkingLevelMap.off !== null`（例如 `deepseek-v4-flash`，`off=undefined`）：pi-ai **主动**下发 `thinking:{type:"disabled"}`，思考是关的，80 token 够用。
- `thinkingLevelMap.off === null`（`kimi-k3`、`glm-5.2`、`glm-5.3` 等，即 issue 列出的那批）：pi-ai **什么都不发**，由 provider 默认决定 —— 这类推理模型默认开启思考，80 token 全被思考吃掉。

而且对这类模型**没有任何可用的关闭手段**：`completeSimple` + `reasoning:"off"` 会被 `clampThinkingLevel()`（pi-ai `dist/models.js:560`）从 `"off"` 向上夹到最低可用等级（`kimi-k3` 会变成 `"max"`），反而更糟。因此唯一出路是把预算提到思考装得下的量级（issue 作者实网验证 1024 可行）。

顺带一提：`ThinkingLevel` 类型本身**不含 `"off"`**（`dist/types.d.ts:23`），`"off"` 只是 `ModelThinkingLevel`/`thinkingLevelMap` 的键。

### 4.3 失败静默

`src/title.ts:141-154`：

```ts
if (message.stopReason === "aborted") return { lengthLimitExceeded: false };
const title = normalizeTitle(...text parts only...);
if (title && isTitleWithinLimit(title)) return { title, lengthLimitExceeded: false };
if (!title) return { lengthLimitExceeded: false };   // ← 截断/空正文走到这里
```

`stopReason: "length"` 不是 `"error"`（`:138`），正文为空时 `title` 为 `undefined`，于是返回一个「什么都没发生」的结果；`src/controller.ts` 只对 `title` / `lengthLimitExceeded` / `error` 反应，因此**不重试、不告警**。`check2.ts` 实测：

```
thinking-only, text 为空, stopReason='length'  ->  {"lengthLimitExceeded":false}   (complete() calls: 1)
无 text part,          stopReason='length'  ->  {"lengthLimitExceeded":false}   (complete() calls: 1)
```

这与 issue 作者「header 修了却像没修」的观察完全一致。

## 5. 缺陷 3：恢复会话会再次触发重命名

`check3.ts` 直接驱动仓库的 controller：

```
=== 场景 A：session_start('resume') 后发一条消息，会话没有名字 ===
  generateTitle 调用次数 : 1    ← 又尝试了一次
=== 场景 B：同前，但会话已有名字 ===
  generateTitle 调用次数 : 0    ← 正确跳过
=== 场景 D：恢复的无名会话，标题成功 ===
  setSessionName 调用: ["Resumed Title"]    ← 恢复的会话被改名
```

真实 `pi` 进程端到端（本地 mock provider，模拟标题请求被 400 拒绝）：

```
RUN 1（新会话，标题请求被拒）      -> session_info 条目数: 0
RUN 2（同一会话，pi -c，再发消息）-> session_info 条目数: 1   {"type":"session_info",...,"name":"Mock Session Title"}
RUN 3（pi -c，会话已有名字）      -> session_info 条目数: 1   （不再发标题请求）
```

代码原因：`src/controller.ts:80` 的闸门只有 `options.getSessionName() !== undefined`，而 `:129-137` 的 `onSessionStart` 会把 `candidate`/`attempted`/`turnFailed`/`userTurnPending` 全部重置。因此**只要这条会话从来没有成功拿到名字**，恢复后就会被重新命名。触发「从来没拿到名字」的现实路径：

- 首轮标题请求失败（缺陷 1 / 2）；
- 会话在异步标题落地前就被关闭；
- 首条消息是未被展开的命令、`!` / `!!` shell 输入（`extractUserPrompt` 返回 `undefined`）或空提示；
- 首轮开始时没有可用模型（`:56-59` 分支不留候选）。

补充：`getSessionName()` 在恢复时确实能读到已存的名字（`dist/core/session-manager.js:845-851` 的 `getSessionName()` 读 `fileEntries` 里的 `session_info`），所以「已命名的会话」不会被重复改名。

**关键约束：不能用 `session_start.reason !== "resume"` 来修。** CLI 的 `pi -r` / `pi -c` 发出的 `session_start` 是 **`reason: "startup"`**：

- 源码：`dist/main.js:681` 创建初始 runtime 时不传 `sessionStartEvent`；`dist/core/agent-session.js:166` 兜底为 `{ type: "session_start", reason: "startup" }`。
- `reason: "resume"` 只出现在进程内切换会话：`dist/core/agent-session-runtime.js:141`、`:291`（交互式 `/resume`）。
- 实测（`probe.ts` 记录真实 `session_start`）：新会话 → `{"reason":"startup"}`；`pi -c` 恢复 → `{"reason":"startup"}`。

唯一可靠的判别依据是会话内容：`ctx.sessionManager.getEntries()` 中 `type === "message" && message.role === "user"` 的条数（新会话为 0，恢复/分叉的会话 ≥1；`session_start` 触发时历史已经加载完毕）。

## 6. 缺陷 4：尝试次数不设上限

`src/controller.ts:118-127`：

```ts
const onAgentSettled = (): void => {
  if (!turnFailed) return;
  turnFailed = false;
  if (options.getSessionName() !== undefined) return;
  activeAbortController?.abort();
  attempted = false;        // ← 解锁
  candidate = undefined;    // ← 允许下一条用户消息再次触发
};
```

`check3.ts` 实测（每条消息的首轮都失败）：

```
  after message 1..6: attempts so far=1,2,3,4,5,6      ← 6/6 条消息都发起了请求
```

「没有可用模型」的分支（`:56-59`）同样不留候选，所以每条后续消息都能再试。`attempted` 只是进程内 latch，`onSessionStart` 又会重置它，跨恢复没有任何保护，也没有任何持久化标记。

`turnFailed` 只服务于这个 reset：它在 `:63` 被清零、在 `onTurnEnd` 里被设置，而 `startRename`（`:80`）读它时必然为 `false`（`startRename` 只在 `onBeforeAgentStart` 里、清零之后被调用），属于连带死代码。

## 7. 与 issue #22 的差异

| issue 的说法 | 核实结果 |
| --- | --- |
| opencode 请求缺 `x-opencode-session` 导致 400 | ✅ 成立 |
| 「扩展拿不到 session id，主循环才注入」 | ✅ 成立，且 0.84.2/0.85.0 连 pi-ai 自己也不注入 |
| 建议用 `transformHeaders` | ✅ 方向正确，且是唯一跨版本可行的形状（`sessionId` 在旧版无效、在 0.87.1 也缺 `x-opencode-client`） |
| 「`maxTokens: 80` 被 thinking 吃光」 | ✅ 现象成立，但**机制不同**：不是「插件要求了最低 reasoning 等级」，而是插件的要求被 pi-ai 忽略、且这类模型没有关闭思考的开关 |
| 「去掉 `reasoning` 参数也没用，必须加大预算」 | ✅ 结论正确（`check5.ts` 佐证），原因是 `reasoning` 从来就没传出去 |
| 建议 `maxTokens: 1024` | ✅ 采纳，且建议无条件提到 1024：`maxTokens` 是输出上限而非实际花费，思考已关闭的模型仍会提前 `stop` |
| 「考虑把无文本结果改成重试/告警」 | ✅ 采纳 |
| —— | ❌ issue 未覆盖：恢复会话会再次命名、尝试次数无上限 |

## 8. 修复设计（A/B/C/D 已实现）

> 实现状态：A、B、C、D 已全部实现并合入。实现中确认一点偏差：无可用模型的 turn 不会真正发出请求，因此不消耗命名机会（保留既有行为，已在 README 写明）。

### A. opencode 路由头

在 `src/index.ts` 的 `before_agent_start` 处已有 `ctx`，用 `ctx.sessionManager.getSessionId()` + `transformHeaders` 注入，gate 与 `provider-attribution.js:50-59` 保持一致（`provider ∈ {opencode, opencode-go}` 或 `baseUrl` host 为 `opencode.ai`），同时下发 `x-opencode-session` 与 `x-opencode-client: pi`。**不要**改用 `options.sessionId`（旧版无效），也不要无差别透传（`openai-completions.js` 的 session affinity 会把 session id 当 `x-session-id` / `session_id` 发给无关 provider）。

### B. 标题请求预算与失败处理

- `maxTokens: 80 → 1024`（覆盖 `off === null` 的模型）。`maxTokens` 是输出的**上限**而不是实际花费：思考已关闭的模型照样会提前 `stop`，所以无条件提高不会额外烧 token；
- 「截断 / 无正文 / 无文本」不再静默：按同一套重试计数重试（**1 次初始 + 3 次重试**，共最多 4 次请求），全部失败后输出英文 warning；
- 重试提示只用于「标题超长」；截断的无正文结果应重发同一提示，不要套用 `buildRetryTitlePrompt`。

### C. 触发窗口与恢复

`session_start` 改为接收 `ctx`，按 `ctx.sessionManager.getEntries()` 统计 user message 数：

- ≥ 1 → 判定为恢复/分叉的会话，本次进程内**永久不可命名**；
- = 0 → 新会话，只有**第一条能真正发出请求的用户消息**可以触发一次；触发即上锁（命令类/`!` 输入、无可用模型的 turn 不会发出请求，因此不消耗这次机会）

同时删除 `onAgentSettled` 的重置/abort（决策：**一律不 abort，让标题请求自己跑完重试**），保留 `session_shutdown` 的 abort（防止旧请求命名新会话）；连带删除 `turnFailed` 与 `onTurnEnd`。命令类/`!` 输入、无模型的分支不应消耗那一次机会（与现有「命令被忽略」的语义一致）。

### D. `getTitleThinkingLevel()` 的处置

判定为**死代码**：它的返回值经 `src/title.ts:135` 进入一个 pi-ai 在 `complete` 路径上不读的字段（§4.1 的源码链路 + `check6.ts` 的抓包）。删除它的后果：

| 方面 | 后果 |
| --- | --- |
| 线上行为 | **无变化** —— 该值本来就没有离开进程（抓包已证） |
| 测试 | `test/index.test.ts:151-156`、`:158-175` 两个用例必须删除；`:115` 对 `options.reasoning` 的断言需要调整 |
| 包 API | `src/index.ts:37` 有 `export * from "./title.ts"`，`getTitleThinkingLevel` 是 npm 包可见的导出，删除属于破坏性变更，changeset 已按 `minor` 记录 |
| 文档 | README「uses the lowest reasoning level that model supports」的表述必须改写 |

备选方案（不删，只停止传参）保留了导出与测试，但会留下一个"看着有用、实际被忽略"的函数 —— 这正是让 issue 作者和早期诊断走偏的原因，建议删除。

**已实现**：`getTitleThinkingLevel()`、`reasoning` 选项与对应的两个单测已删除，changeset 记为 `minor`（删除包导出属破坏性变更）。

## 9. 回归风险与待验证项

- `maxTokens: 1024` 能否覆盖所有 `off === null` 的模型：issue 作者只在实网上验证了部分模型；**本报告无法在离线环境验证**，需要真实 `opencode-go` 请求确认。
- `transformHeaders` 的 gate 是否要复用 pi 的 `matchesHost` 语义（`new URL(baseUrl).hostname === "opencode.ai"`）而不是 `includes("opencode.ai")`（防止 `evil-opencode.ai.evil.tld` 之类的子串绕过）。
- 删除导出对 0.2.x 用户的影响面（是否有插件/脚本 import 过 `@lystran/pi-session-rename` 的 `getTitleThinkingLevel`）。
- `session_start` 触发时 `ctx.sessionManager.getEntries()` 对**新会话**必须为 0 条 user message；对「`/new` 新开、随后立刻恢复」的边界需要补测试。

## 10. 附录 A：可复现命令

```bash
# 抓 header（三个形状 × 三个 pi-ai 版本）
bun run /tmp/pi-rename-diag/check1.ts <pi-ai 包根目录>

# 抓 body：complete vs completeSimple 对 reasoning 的处理
bun run /tmp/pi-rename-diag/check5.ts <pi-ai 包根目录>

# 端到端：真实 generateTitle + 真实 models.complete 的 outgoing body
bun run /tmp/pi-rename-diag/check6.ts <pi-ai 包根目录>

# 静默失败：fake complete()
bun run /tmp/pi-rename-diag/check2.ts

# 触发窗口 / 恢复重命名：驱动真实 controller
bun run /tmp/pi-rename-diag/check3.ts

# 真实 pi 进程 + 本地 mock provider（观察 session_start.reason 与 session_info 落盘）
bun run /tmp/pi-rename-diag/mock-provider.ts &
PI_CODING_AGENT_DIR=/tmp/pi-rename-diag/agent /tmp/pi-rename-diag/runpi.sh \
  pi --no-extensions -e /Users/lystran/programming/ai/pi-extensions/plugins/pi-session-rename/src/index.ts \
  --session-dir /tmp/pi-rename-diag/sessions1 -p "hello" --provider mock --model mock-1
```

`<pi-ai 包根目录>` 候选：

- `plugins/pi-session-rename/node_modules/@earendil-works/pi-ai`（0.84.2，插件 devDeps）
- `~/.pi/agent/npm/node_modules/@earendil-works/pi-ai`（0.85.0，已安装插件实际解析）
- `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-ai`（0.87.1，真实运行）

## 11. 附录 B：issue #22 回复草稿（可直接粘贴，语言：英文）

```markdown
Thanks for the very detailed report — the header analysis was correct and it saved me a lot of
time. I reproduced everything locally (mock provider on 127.0.0.1, no real network) against
pi-ai 0.84.2 / 0.85.0 / 0.87.1 and there is one correction plus two extra findings.

**1. `transformHeaders` is the right fix, `sessionId` is not.** pi-ai only grew
`providers/opencode-headers.js` in newer releases (present in 0.87.1, absent in 0.84.2 and
0.85.0), and it reads `options.sessionId`; on 0.87.1 that shape also misses
`x-opencode-client: pi`. Captured outgoing headers for an `opencode-go` model:

| options | pi-ai 0.84.2 | 0.85.0 | 0.87.1 |
| --- | --- | --- | --- |
| plain | `{}` | `{}` | `{}` |
| `sessionId` | `{}` | `{}` | `x-opencode-session` only |
| `transformHeaders` | both headers | both headers | both headers |

The gate has to mirror `getSessionHeaders()` in pi-coding-agent: `provider` is
`opencode`/`opencode-go`, or the `baseUrl` hostname is exactly `opencode.ai`.

**2. The `reasoning` option never reached the provider, so the mechanism in your second
root cause is different.** `modelRegistry.complete()` goes through
`ModelRuntime.complete()` → `provider.stream()`, and only `streamSimple()` maps
`reasoning` (`ThinkingLevel`) into `reasoningEffort`. Captured request bodies driving the
real `generateTitle`:

    deepseek-v4-flash  plugin computes reasoning="high"  -> {"thinking":{"type":"disabled"},"max_tokens":80}
    kimi-k3            plugin computes reasoning="max"   -> {"max_tokens":80}
    glm-5.2            plugin computes reasoning="high"  -> {"max_tokens":80}

So the plugin has never been able to change the thinking level, and "use a lower level" is
not an available lever. The actually broken set is exactly the models with
`thinkingLevelMap.off === null`: pi-ai emits no thinking parameter for them, the provider
defaults to thinking on, and it eats the 80-token budget. There is no request shape that
turns thinking off for those models (`completeSimple` + `off` gets clamped up to the lowest
available level), so your `maxTokens: 1024` conclusion is right — just for a different
reason than the level never being off.

**3. Bonus silent-no-op path.** Any `stopReason: "length"` with zero text parts (and any
`stop` with empty content) returns `{ lengthLimitExceeded: false }` and no warning. That is
being changed to retry (1 initial + 3 retries) and finally warn, so this class of failure
can never look like a no-op again.

**4. Two things the issue did not cover, which I also reproduced.** An unnamed session that
is resumed with `pi -r`/`pi -c` gets renamed again (the only gate is `getSessionName()`,
which is `undefined` for every session whose first naming attempt failed), and attempts are
unbounded — a failed first turn re-arms on the 3rd, 4th, ... message (6/6 in my harness).
Note that `session_start.reason !== "resume"` cannot fix this: CLI resume reports
`reason: "startup"`, only the interactive `/resume` reports `"resume"`. The fix seeds
eligibility from `sessionManager.getEntries()` at `session_start` and only allows the first
user message to trigger.

Planned for the next release: header injection via `transformHeaders`, a title budget that
covers forced-thinking models, retry+warning instead of a silent no-op, and a rename
attempt window limited to the first user message of a genuinely new session. I will drop
`getTitleThinkingLevel()` as well, since it is provably a no-op.
```

# Pi 生态「唤起不在终端的用户注意力」既有做法

> 调研对象：`@juicesharp/rpiv-ask-user-question@2.11.0` 的注意力信号与公开事件契约，以及它在 Pi 生态里是否真的被消费
>
> 调研时间：本轮运行（本机 Pi 0.87.1 / npm registry 数据快照日期见各条引用）
>
> 证据等级标记：
> - 【源码证实】= 直接读本机已安装源码；或读 npm 已发布 tarball 的同一版本文件（用于独立复核）
> - 【文档证实】= 包内 README / docs 原文
> - 【源码推断】= 由源码结构或注释推得，源文件未逐字写明
> - 【未证实】= 本轮未取得证据
>
> 主源路径缩写：
> - **RPIV** = `/Users/lystran/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question`（2.11.0，直接发布 TS）
> - **PKG** = `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-coding-agent`（0.87.1）
> - **GUARD** = `/Users/lystran/programming/ai/pi-extensions/plugins/pi-guard`（本仓库，只读参照）

---

## 摘要

在 Pi 生态里，「唤起不在看终端的用户」目前被实际采用的做法只有四类：**(1)** 自己 spawn/调用系统通知进程（绝大多数通知插件、以及本仓库 pi-guard）；**(2)** 只写终端级信号（BEL / OSC，无进程）；**(3)** 由产生阻塞的一方**发布公开事件**、由独立通知插件订阅消费；**(4)** 不做检测，直接订阅宿主 Pi 自己发出的 `ui_prompt_start` 生命周期事件。

`@juicesharp/rpiv-ask-user-question@2.11.0` 是 **(2)+(3)** 的混合先例：它写**恰好一个** BEL 到 `process.stdout`（`isTTY` 门控），并发 `rpiv:ask-user:prompt` / `rpiv:ask-user:blocked` 两个事件。**它确实被消费过，但只有一个消费者**：`@pi-unipi/notify@2.20.5` 订阅 `rpiv:ask-user:prompt`（由该事件的起源 PR 明确指名，见 §3），且该订阅在 UniPi 默认配置中是**关闭**的。`rpiv:ask-user:blocked` **截至调研未发现任何消费者**。因此「事件存在」≠「通知问题已解决」：RPIV 自己没有做任何系统级通知，它的 README「Related」一节也没有列出任何通知插件。

对本仓库 pi-guard 最具参考价值的相邻先例不是 RPIV，而是 **`@gotgenes/pi-permission-system@33.0.8`**（月下载 41K，与 pi-guard 同类：权限/审批守卫）——它发布文档化的 `permissions:ui_prompt` 广播，其文档原文就说这个事件是给「notification extensions」用的（见 §6、§7）。

---

## 1 该插件的「注意力信号」完整清单

### 1.1 只有一种信号：一个 BEL 写到 stdout

【源码证实】`RPIV/ask-user-question.ts:87-103` 全文（本机源码逐行复核，行号已用 offset 读取确认）：

```
87  /** Standard terminal bell — same byte rpiv-warp exports as OSC_TERMINATOR. */
88  export const BEL = "\x07";
89
90  /**
91   * Emit one portable terminal attention signal without touching redirected output.
92   * Writes to stdout rather than rpiv-warp's `/dev/tty` transport: the `isTTY` gate
93   * both proves an interactive terminal owns the coming wait and keeps the byte out
94   * of piped RPC transports (VS Code pendant, Zed) — a `/dev/tty` write would ring
95   * even when the questionnaire renders in a remote host's own UI.
96   */
97  function emitTerminalAttention(): void {
98      try {
99          if (process.stdout.isTTY) process.stdout.write(BEL);
100     } catch {
101         // Terminal attention is best effort; the questionnaire must still proceed.
102     }
103 }
```

逐条回答子问题：

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| BEL 的确切字节 | `"\x07"`，即 ASCII `BEL`（`\a`，0x07），**单字节**，导出为 `BEL` 常量 | 【源码证实】`ask-user-question.ts:88` |
| 写入通道 | Node 的 `process.stdout` **流**（不是裸 fd 1 的 `writeSync`，也不是 `/dev/tty`） | 【源码证实】`ask-user-question.ts:99` |
| TTY 门控 | `process.stdout.isTTY` 为真才写；假则完全不写 | 【源码证实】`ask-user-question.ts:99` |
| best-effort 语义 | `try/catch` 全吞，注释原文「Terminal attention is best effort; the questionnaire must still proceed.」；同步写失败不影响问卷继续 | 【源码证实】`ask-user-question.ts:100-102` |
| 触发时机 | **恰好一次**，紧贴在进入交互等待之前（TUI 与 RPC 两条路径各一次） | 【源码证实】见 1.2 |
| 是否可配置 | **没有**任何控制 BEL / 通知 / 响铃的配置项。`config.ts` 只有 `collapseKey` 与 `guidance.*` | 【源码证实】`RPIV/config.ts:9-16`（interface）、`config.ts:77-79`（读取） |
| 平台分支 | 无。代码里没有 `process.platform` 判断，也没有 Windows 分支 | 【源码证实】`ask-user-question.ts:97-103` |

### 1.2 「为什么写 stdout 而不是 /dev/tty」——源码注释原文

这是本次调研里唯一一处作者显式解释设计取舍的地方，原文（`ask-user-question.ts:91-95`）：

> Emit one portable terminal attention signal without touching redirected output.
> Writes to stdout rather than rpiv-warp's `/dev/tty` transport: the `isTTY` gate
> both proves an interactive terminal owns the coming wait and keeps the byte out
> of piped RPC transports (VS Code pendant, Zed) — a `/dev/tty` write would ring
> even when the questionnaire renders in a remote host's own UI.

【源码证实】拆成三个论点：
1. `isTTY` 门控**同时**承担两件事：证明「即将到来的等待属于一个交互式终端」，以及把字节挡在管道化的 RPC 传输之外。
2. 具体被点名的 RPC 宿主：**VS Code pendant**、**Zed**。
3. `/dev/tty` 的问题：即使问卷是在远程宿主自己的 UI 里渲染，写 `/dev/tty` 也会响铃——因为 `/dev/tty` 指向的是**承载 Pi 进程的那个控制终端**，与「用户此刻在看哪个 UI」无关。

### 1.3 全部调用点（3 处，含定义）

| file:line | 上下文 | 前置守卫 |
| --- | --- | --- |
| `ask-user-question.ts:66` | `runRpcPath()` 内 | 仅当 `ctx.mode === "rpc" && hasDialogUI(ctx.ui)`（`:334`）才进入该函数；在 `emitAskUserBlockedEvent(pi, true)`（`:64`）之后 |
| `ask-user-question.ts:371` | TUI 主路径 | 在 `emitAskUserBlockedEvent(pi, true)`（`:369`）之后、`await ctx.ui.custom(...)`（`:372`）之前 |
| `ask-user-question.ts:97` | 函数定义 | — |

【源码证实】TUI 主路径的实际顺序（`ask-user-question.ts:314-372`，逐行复核）：

```
:316  if (!ctx.hasUI) return rejectWithoutUi();
:318  const validation = validateQuestionnaire(typed);
:319-326  if (!validation.ok) return buildToolResult(validation.message, {...});
:330  emitAskUserPromptEvent(pi, typed);          // 事件
:334  if ((ctx as { mode?: string }).mode === "rpc" && hasDialogUI(ctx.ui))
:335      return runRpcPath(pi, ctx.ui, typed);   // RPC 分支 → :66 BEL
:341  const sessionLoad = await loadQuestionnaireSession();
:342-343  if (!sessionLoad.ok) return buildToolResult(sessionLoad.message, {...});
...
:369  emitAskUserBlockedEvent(pi, true);
:370  try {
:371      emitTerminalAttention();                 // TUI BEL
:372      const result = await ctx.ui.custom<QuestionnaireResult>(...)
:402-404  } finally { removeOverlayInputListener?.(); emitAskUserBlockedEvent(pi, false); }
```

### 1.4 明确不发 BEL 的情形

【文档证实】`RPIV/docs/hosts.md:18` 原文点名三类：

> No BEL is emitted for missing UI, invalid questionnaires, or a failed TUI session load.

【源码推断】按上面 `:314-372` 的 return 顺序，以下情形都在到达 `emitTerminalAttention()` 之前返回，故不会写 BEL：
1. `!ctx.hasUI`（`:316`）；
2. `validateQuestionnaire` 不通过（`:319`，含 `no_questions` / `too_many_questions` / `duplicate_question` / `empty_options` / `reserved_label` / `duplicate_option_label`）；
3. `loadQuestionnaireSession()` 返回 `ok:false`（`:342`，即 `session_load_failed` / `stale_module_cache`）；
4. RPC 分支但 `hasDialogUI(ctx.ui)` 为假 → 不进 `runRpcPath`；
5. `ctx.ui.custom` 解析为 `undefined` 的 `no_custom_ui` 兜底（`:405` 附近 `resolveUndefinedResult`）——此时 finally（`:402-404`）只会配对发 `blocked=false`，因为 BEL 这一侧从未执行。

【源码推断】RPIV 全包**没有**任何系统级通知手段：`spawn` / `child_process` / `terminal-notifier` / `osascript` / `notify-send` / `afplay` / `gdbus` 全包零命中；`stdout.write` 仅两处（BEL，以及 `state/external-editor.ts` 的一行纯文本）。`OSC` 仅出现在 `view/components/preview/preview-box-renderer.ts:4,24`，且是**剥离** OSC8 超链接的正则，不是发送。

【文档证实】`RPIV/docs/hosts.md:16` 补充一个路径细节：

> ... A TTY-backed RPC dialog walker receives the same signal as the TUI path.

---

## 2 公开事件契约

### 2.1 channel 与 payload

【源码证实】`RPIV/events.ts`（全文 59 行）：

| file:line | 内容 |
| --- | --- |
| `events.ts:1-20` | 文件头 STABILITY POLICY（5 条）+ 命名约定 |
| `events.ts:22` | `export const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt" as const;` |
| `events.ts:24-26` | `AskUserPromptEventPayload { questions: ReadonlyArray<AskUserPromptQuestion>; }` |
| `events.ts:28-32` | blocked 的 doc 注释：「Emitted while the questionnaire is awaiting user input (TUI `ui.custom` and RPC dialog walker). Cleared with `{ active: false }` in `finally` so listeners can distinguish blocked-on-human from working.」 |
| `events.ts:33` | `export const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked" as const;` |
| `events.ts:35-38` | `AskUserBlockedEventPayload { /** True while input is awaited; false when the wait ends (answer, cancel, or error). */ active: boolean; }` |
| `events.ts:40-52` | `AskUserPromptQuestion { question: string; header: string; multiSelect: boolean; options: ReadonlyArray<AskUserPromptOption>; }` |
| `events.ts:54-59` | `AskUserPromptOption { label: string; description: string; /** True iff the option carries rich preview content (content not shipped). */ hasPreview: boolean; }` |

【源码证实】契约的可导入路径：`RPIV/package.json` 中有

```json
"exports": { ".": "./index.ts", "./events": "./events.ts" }
```

`RPIV/index.ts:42-49` 重新导出两个常量 + 四个类型（`ASK_USER_BLOCKED_EVENT`、`ASK_USER_PROMPT_EVENT`、`AskUserBlockedEventPayload`、`AskUserPromptEventPayload`、`AskUserPromptOption`、`AskUserPromptQuestion`）；`index.ts:51-54` 是默认工厂。

【文档证实】`RPIV/docs/tool-schema.md`「Event contract」一节给出的消费者用法：

```ts
import { ASK_USER_PROMPT_EVENT, type AskUserPromptEventPayload } from "@juicesharp/rpiv-ask-user-question/events";

pi.events.on(ASK_USER_PROMPT_EVENT, (payload: AskUserPromptEventPayload) => { ... });
```

### 2.2 STABILITY POLICY 的 5 条（原文）

【源码证实】`RPIV/events.ts:4-19`：

```
4  * STABILITY POLICY — applies to every event in the `rpiv:*` namespace.
6  *   1. Channel names are immutable. Once shipped, never rename.
7  *   2. Payload changes are append-only. Listeners MUST tolerate unknown
8  *      fields. New fields ship as optional (`?:`).
9  *   3. Breaking changes (rename, retype, remove a field; change emission
10 *      semantics) require a NEW channel, e.g. `rpiv:ask-user:prompt.v2`,
11 *      with dual-emit during a deprecation window.
12 *   4. No `version` field inside payloads. Version via channel name only.
13 *   5. Payloads must be JSON-safe: primitives, arrays, plain objects.
14 *      No Set/Map/Date/class instances — payloads must survive JSON
15 *      serialization when listeners forward them across process or
16 *      network boundaries.
18 * Naming: `rpiv:<package-or-tool>:<phase>`, lowercase, hyphen-separated.
19 * Aligns with Pi's `"my-extension:status"` example and UniPi's `unipi:*`.
```

- **命名约定**：`rpiv:<package-or-tool>:<phase>`，全小写、连字符分隔（`:18`）。
- **为什么要求 JSON-safe**：原文给的理由是 `:13-16`——「listeners forward them across process or network boundaries」。
- **对齐依据**：`:19` 点名了 Pi 自己的 `"my-extension:status"` 示例与 UniPi 的 `unipi:*`。
  【未证实】本机 PKG 0.87.1 的 `docs/` 与 `examples/` 中**未检索到**字面 `my-extension:status`；只找到 `PKG/examples/extensions/event-bus.ts:21,31,38` 用的 `"my:notification"`。这条引用可能来自更早的文档版本或作者记忆。
- 【文档证实】`RPIV/docs/tool-schema.md` 用另一种措辞复述了同一政策：「channel names are immutable, payload changes are append-only and always optional, payloads stay JSON-safe, and any breaking change ships as a new channel (e.g. `rpiv:ask-user:prompt.v2`) rather than a version field」。

### 2.3 prompt 与 blocked 的语义分工

| channel | 语义 | 发射点 | payload 形状 | 次数 |
| --- | --- | --- | --- | --- |
| `rpiv:ask-user:prompt` | 「**有内容要看**」——一次性告知问卷即将展示，携带完整问题投影 | `ask-user-question.ts:49`（`emitAskUserPromptEvent` 内），唯一调用点 `:330` | `{ questions[] }`，含每个问题的全文、header、multiSelect、options(label/description/hasPreview) | 每次工具调用 1 次 |
| `rpiv:ask-user:blocked` | 「**正卡在等人**」——`active:true` 表示开始等人类输入，`active:false` 在 `finally` 清除 | `ask-user-question.ts:54`（`emitAskUserBlockedEvent` 内），4 个调用点 | `{ active: boolean }` | 成对，每路径 1 对 |

【源码证实】`emitAskUserBlockedEvent` 的 4 个调用点：`:64`（RPC 开始等）、`:69`（RPC `finally` 清除）、`:369`（TUI 开始等）、`:404`（TUI `finally` 清除）。

【源码证实】为什么 blocked 要区分「等人」和「干活」：`events.ts:30-31` 原文——「Cleared with `{ active: false }` in `finally` so listeners can distinguish blocked-on-human from working」。

【源码证实】`ask-user-question.ts:329` 的发送点注释直接写出预期消费者类型：

```
// Emit event for external listeners (e.g., notification plugins)
```

【文档证实】`RPIV/docs/tool-schema.md`「Event contract」一节说 prompt 事件「emitted after validation passes and before the dialog is shown」，与代码 `:330` 位置一致。

**⚠️ 契约缺口（本轮新发现）**：【文档证实+源码证实】`RPIV/docs/tool-schema.md` 的「Event contract」一节**只文档化了 `rpiv:ask-user:prompt`**，完全没有提到 `rpiv:ask-user:blocked`。`blocked` 只存在于 `events.ts` 的代码注释里。README 的 Reference 列表对该文档的描述也只写了「the `rpiv:ask-user:prompt` event」。也就是说：**blocked 是一个已发布但未文档化的 channel**。

---

## 3 谁在消费这些事件（本调研最关键的一条）

### 3.1 结论

| channel | 消费者 | 状态 |
| --- | --- | --- |
| `rpiv:ask-user:prompt` | **`@pi-unipi/notify`**（1 个，已发布 npm 包） | 存在，但**默认关闭**（需用户显式开启） |
| `rpiv:ask-user:blocked` | **截至调研未发现消费者** | 无 |

### 3.2 唯一的消费者：`@pi-unipi/notify@2.20.5`

【源码证实·独立复核】我用 npm 已发布 tarball（`https://unpkg.com/@pi-unipi/notify@2.20.5/events.ts`）复核，不依赖前一位子代理的本地解包：

- `events.ts:21-24`：
  ```ts
  // Event emitted by @juicesharp/rpiv-ask-user-question before showing its UI.
  // Keep this as a local string until that package publishes an importable
  // `./events` contract in npm.
  const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt" as const;
  ```
- `events.ts:224-237`（文件末尾的专用订阅块）：
  ```ts
  const askUserConfig = config.events["ask_user_prompt"];
  if (askUserConfig?.enabled) {
    unsubs.push(pi.events.on(ASK_USER_PROMPT_EVENT, (payload: unknown) => {
      const title = `Pi — ${BUILTIN_EVENTS.ask_user_prompt.label}`;
      const message = buildAskUserPromptMessage(payload);
      dispatch(pi, title, message, askUserConfig.platforms, "ask_user_prompt", config, cwd, "high")...
      armRenotify(pi, title, message, askUserConfig.platforms, "ask_user_prompt", config, cwd, dispatch);
    }));
  }
  ```
- 【源码证实】payload 适配：`ask-user-prompt-message.ts` 文件头注释原文——「Supports both UniPi's flat `unipi:ask-user:prompt` payload and the lossless `rpiv:ask-user:prompt` questionnaire projection.」；函数 `buildAskUserPromptMessage` 先读 `p.questions[]`（lossless 形状），只有 `questions` 为空且存在 `question`/`context` 键时才走扁平形状。**说明消费者与已发布的契约形状是兼容的。**
- 【源码证实·默认关闭】`settings.ts:31`（`DEFAULT_CONFIG.events` 内）：`ask_user_prompt: { enabled: false, platforms: [] },`。同表里只有 `workflow_end` / `ralph_loop_end` / `mcp_server_error` 三项默认 `enabled: true`。
- 【源码证实】它的通知能力是「自己 spawn/调用系统通知」路线：`platforms/native.ts:10` `import notifier from "node-notifier";`，`:60` `notifier.notify({ title, message, appID }, cb)`；另有 Gotify / Telegram / ntfy 三个 HTTP 平台。
- 【源码证实】它**没有**迁移到 `@juicesharp/rpiv-ask-user-question/events` 的可导入契约：仍然自己声明 `ASK_USER_PROMPT_EVENT` 字符串常量与本地类型（`events.ts:22-23` 的注释写于契约发布之前，至今未改）。这是一个可验证的「契约虽已发布，但消费者未跟进」的事实。

### 3.3 起源 PR 明确指名了这个消费者

【文档证实】`github.com/juicesharp/rpiv-mono/pull/39`（标题 `feat(rpiv-ask-user-question): emit rpiv:ask-user:prompt event before showing questionnaire`，作者 `hhelibeb`，分支名 `ask-user-notify-bridge`，2026-05-22 创建 / 2026-05-23 合并，state: MERGED）：
- PR body 原文：「Emit `"rpiv:ask-user:prompt"` on the shared EventBus after validation passes and before the questionnaire UI is shown, so external listeners — **such as `@pi-unipi/notify`** — can alert the user via cross-platform notification.」
- PR body 原文：「The corresponding listener side is in `@pi-unipi/notify` (UniPi#12).」
- 维护者 review 原文：「the companion listener in `Neuron-Mr-White/UniPi#12` **proves the use case**」
- 维护者 review 原文：「**this is the first `rpiv:*` event the monorepo has ever published**」

【源码推断】由此可确认：这个事件的**动机**是「让独立通知插件代替本插件发声」，而不是「本插件自己通知用户」。这也解释了为什么 RPIV 自己只写一个 BEL。

### 3.4 rpiv-warp 不是消费者

【源码证实·独立复核】对 npm 已发布 tarball（`unpkg.com/@juicesharp/rpiv-warp@2.11.0/index.ts`）取代码：rpiv-warp 用的是**宿主生命周期事件** `pi.on("tool_call")` / `pi.on("tool_execution_end")` / `pi.on("agent_end")` 等，配合 `DEFAULT_BLOCKING_TOOLS = ["ask_user_question"]` 判定「正在等人」。它**不订阅** `rpiv:ask-user:*`。
【源码推断】换句话说，@juicesharp 自己的两个包在解决同一件事时各走一路：`rpiv-ask-user-question` 发事件，`rpiv-warp` 不去订阅事件、而是自己在 `tool_call` 上重新识别 `ask_user_question`。**生态内部并未闭环。**

### 3.5 `rpiv:ask-user:blocked` 的消费者：未发现

【源码证实】同一个消费者 UniPi 在**同一个位置**（`events.ts:241-246`）订阅的是**另一个命名空间**的事件来收起重复提醒：

```ts
unsubs.push(pi.events.on("herdr:blocked", (payload: unknown) => {
  if ((payload as { active?: unknown } | null)?.active === false) disarmRenotify();
}));
```

即：UniPi 需要「等人结束了」这个信号以停止 re-notify 循环，而它选择监听 `herdr:blocked`（herdr 生态的阻塞状态契约，语义与 `rpiv:ask-user:blocked` 高度重合），**没有监听 `rpiv:ask-user:blocked`**。
【源码推断】合理猜测是消耦/时序原因（UniPi 想要一个与具体问卷插件无关的通用阻塞信号），但源码与文档都没有说明原因——见 §9 未证实项。

### 3.6 我检索过的位置与查询（穷举）

| 位置 / 手段 | 查询 | 结果 |
| --- | --- | --- |
| npm registry search API | `text=rpiv:ask-user&size=20` | 无源码索引，返回泛化结果；顺带发现 `@zzxb/pi-notify`、`@oai404iao/pi-telegram-notify`、`@jetserge/pi-telegram-ask-mirror` |
| npm registry search API | `text=ask_user_question pi` | 命中 RPIV 本身与一批 Pi 生态包（`pi-subagents`、`pi-mcp-adapter`…），无 `rpiv:ask-user` 消费者 |
| npm registry search API | `text=keywords:pi-package notification` / `keywords:pi-package notify` | 列出约 20 个通知类 Pi 扩展（见 §6），逐个看描述后只锁定 UniPi 一个候选 |
| npm 已发布 tarball 直读（unpkg） | `@pi-unipi/notify@2.20.5` 的 `events.ts` / `ask-user-prompt-message.ts` / `settings.ts` | **命中**：唯一消费者 |
| npm 已发布 tarball 直读（unpkg） | `@jetserge/pi-telegram-ask-mirror@0.1.0/index.ts` | **明确不是**消费者：它**包装工具**而非订阅事件，文件头原文「its `rpiv:ask-user:*` events are one-way, **with no channel to send an answer back**. So a third surface cannot be registered from outside.」 |
| GitHub code search | `"rpiv:ask-user:blocked"` (type=code) | **被拒**：需登录（页面原文「Sign in to search code on GitHub」） |
| Sourcegraph 公共搜索 | `context:global rpiv:ask-user` | **403 Forbidden** |
| grep.app API | `rpiv:ask-user` / `rpiv:ask-user:blocked` / `rpiv:ask-user:prompt` / `ask-user:blocked`（4 次尝试） | **全部 HTTP 429 Too Many Requests**，本轮无法完成代码级全网检索 |
| searchcode.com API | `rpiv:ask-user` | **404**（旧端点已下线） |
| Web 搜索（多种措辞） | `"rpiv:ask-user:prompt" pi extension event`、`"ASK_USER_BLOCKED_EVENT" rpiv`、`"rpiv:ask-user" listener extension github`、`rpiv-mono "ask-user:blocked" pull request` | 只找到 RPIV/Warp 自己的页面、`pi.dev` 包页、以及 1 条 PR 结果（#39）。**没有任何第三方消费者的痕迹** |
| npm 命名空间 `@juicesharp/*` | 全量列出（17 条含 fork） | 无名字含 `notify`/`notification` 的包；唯一做通知的是 `rpiv-warp`（且限定 Warp 终端） |

**明确声明：`rpiv:ask-user:blocked` 截至本次调研未发现消费者。GitHub code search 与 grep.app 两个代码级检索通道本轮受阻（登录墙 / 429），所以这一条是「未发现」而不是「已证明不存在」。**

### 3.7 RPIV 自己怎么描述「谁在用」

【文档证实】`RPIV/README.md:78-81`「Related」一节只列了两个包：`@juicesharp/rpiv-i18n`（本地化）与 `@juicesharp/rpiv-pi`（umbrella）。**没有任何通知插件**。
【文档证实】`RPIV/docs/tool-schema.md:3-4` 开头也写着「...and the event other extensions can listen to」，但通篇没有指认任何一个消费者。
【源码推断】结论：`ask-user-question.ts:329` 注释里的「e.g., notification plugins」是**前瞻性表述**，唯一已知实例是 UniPi，且它并未被 RPIV 的文档指认。

---

## 4 `rpiv-warp` 是什么包

【源码证实·独立复核】`@juicesharp/rpiv-warp@2.11.0`（npm registry：`version = '2.11.0'`，`description = 'Pi extension. Native Warp terminal notifications, dispatched via OSC 777 on Pi lifecycle events.'`，`repository = git+https://github.com/juicesharp/rpiv-mono.git`，`directory = packages/rpiv-warp`，dependencies `@juicesharp/rpiv-config ^2.11.0`）。以下代码引自发布 tarball 的 `warp-notify.ts` 与 `index.ts`。

### 4.1 它写哪些转义序列

【源码证实】`warp-notify.ts` 常量区：

```ts
export const OSC_INTRODUCER = "\x1b]";
export const OSC_TERMINATOR = "\x07";        // ← 就是 BEL
export const OSC_777_PREFIX = "777;notify";
export const OSC_0_PREFIX = "0";
export const CSI_INTRODUCER = "\x1b[";
export const CSI_PUSH_TITLE = "22;0t";
export const CSI_POP_TITLE = "23;0t";
```

模块头注释原文列出它发射什么，以及各自用途：

> - OSC 777 — Warp's structured cli-agent notification (badge state + toast). Single emission per lifecycle event; see `index.ts`.
> - OSC 0 — terminal title set. Driven from `title-spinner.ts` every 160ms to animate Warp's per-tab activity dots; same mechanism Claude Code uses (anthropics/claude-code#17887).
> - CSI 22;0t / CSI 23;0t — xterm window-title stack push/pop. Used by `title-spinner.ts` to snapshot Warp's existing tab title before the animation starts and restore it verbatim on stop, so the `π - <repo>` label Pi sets at startup survives the spinner round trip.

格式化函数：
- `formatOSC777(title, body)` = `${ESC}]777;notify;${title};${body}${BEL}`
- `formatOSC0(title)` = `${ESC}]0;${title}${BEL}`
- `formatPushTitleStack()` = `${ESC}[22;0t`；`formatPopTitleStack()` = `${ESC}[23;0t`

**关键点：`OSC_TERMINATOR` 与 RPIV 导出的 `BEL` 是同一个字节 `"\x07"`。** RPIV 的注释（`ask-user-question.ts:87`）原文就说「same byte rpiv-warp exports as OSC_TERMINATOR」——两边共用 OSC 的 ST（String Terminator）字节。

**不写 OSC 9 / 99 / 8**：【源码证实】本包源码中 OSC 前缀只有 `777;notify` 与 `0`，没有 9 / 99 / 8。
【未证实】包内 `docs/events.md`（前一位子代理解包时读到）声称 wire format 为 `ESC ] 777 ; notify ; warp://cli-agent ; <json> BEL`；本轮我未独立复核该文档文件，但源码 `formatOSC777` 与该格式一致。

### 4.2 `OSC_TERMINATOR` 与 `/dev/tty` 传输各做什么

- `OSC_TERMINATOR`：**是 OSC 序列的结束符**（OSC 的 ST），不是「响铃信号」。在终端语义里 `BEL` 与 `ST` 共用 0x07 这一个字节，所以写 OSC 时它不产生响铃效果，它是序列的一部分。RPIV 借用同一个字节作为**独立**的响铃信号——两者用途不同，只是字节相同。
- `/dev/tty` 传输：Unix 上**不写 stdout**，而是 `fs.openSync("/dev/tty", "w")` → `fs.writeSync(fd, bytes)` → `fs.closeSync(fd)`。模块头注释原文：

  > Writes Warp's OSC escape sequences to the controlling terminal. On Unix this is `/dev/tty`; on Windows there is no `/dev/tty`, so we write the same OSC bytes to `process.stdout` and rely on ConPTY to forward them to Warp (per Warp's "Bringing Warp to Windows" eng blog: "ConPTY will send even unrecognized OSCs to the shell").
  >
  > Each call on Unix opens, writes, and closes the fd — no fd cache (matches bash precedent: warp-notify.sh:21).

【源码证实】Windows 分支：
```ts
function writeStdout(bytes: string): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write(bytes);
}
```
即 Windows 上仍然有 `isTTY` 门控，注释原文「Skipped when stdout isn't a TTY (piped/redirected output would either pollute downstream consumers or never reach the terminal)」。

### 4.3 它如何避免与 Pi TUI 的差量渲染竞争

【源码证实+注释原文】四个机制，全部能在源码里指出：

1. **写 `/dev/tty` 而不是 stdout（Unix）**——由此**完全绕开** Pi TUI 的 stdout 差量渲染路径，不污染 Pi 自己维护的帧缓冲。这是与 RPIV「写 stdout」相反的取舍，代价是丢掉了 `isTTY` 门控（也因此 RPIV 的注释专门批评了这一点，见 §1.2）。
2. **每次发射都 open/write/close fd，不缓存 fd**（模块头注释引用 bash 先例 `warp-notify.sh:21`），避免长期持有终端句柄。
3. **错误静默**：`writeRaw()` 里两层 `try/catch`，注释「silent skip — best-effort on Windows」/「silent skip — matches bash `warp-notify.sh:21`」；`closeQuietly()` 吞掉关闭失败。
4. **单次发射**：OSC 777 每个生命周期事件只发一次（注释「Single emission per lifecycle event」）；标题动画（OSC 0，每 160ms 一次）不在我本次的调研重点内，但它先 push 标题栈、停止时 pop 还原 Pi 的 `π - <repo>` 标签，避免把 Pi 设的标题搞丢。

【源码推断】机制 1 是它与 RPIV 的核心分野：**`/dev/tty` 保证「序列一定进到真正的终端」，代价是「无法判断用户此刻是否在看这个终端」**；RPIV 选 stdout + `isTTY` 保证「非交互就闭嘴」，代价是「在 RPC 宿主里可能写得进但用户没在看那个 UI」。

### 4.4 入口门控与触发时机

【源码证实】`index.ts` 的默认工厂第一件事就是环境门控：

```ts
const warp = detectWarpEnvironment();
if (!warp.isWarp || !warp.supportsStructured) return;   // 非 Warp 终端直接不注册
```

不是 Warp 终端时**整个扩展什么都不做**（因此它对绝大多数用户是「不存在」的）。

【源码证实】触发 `question_asked` 的路径：
```ts
pi.on("tool_call", async (event, ctx) => {
    if (!blockingTools.has(event.toolName)) return;
    captureBlockingCall(event.toolCallId, event.toolName, event.input);
    emit(buildQuestionAskedPayload(ctx));
    stopSpinner();
    stopHeartbeat();
});
pi.on("tool_execution_end", async (event, ctx) => {
    if (!blockingTools.has(event.toolName)) return;
    const pending = consumeBlockingCall(event.toolCallId);
    emit(buildToolCompletePayload(ctx, event.toolName, pending?.input));
    ...
});
```
`blockingTools` 来自 `config.ts` 的 `getBlockingTools()`，默认值 `DEFAULT_BLOCKING_TOOLS = ["ask_user_question"]`。
【源码证实】`pi.on("agent_end")` 会先把残留的 blocking call 逐个 drain 掉再发 `stop`——源码注释原文：「An ESC/abort during a blocking tool never fires `tool_execution_end`, so entries linger here until `agent_end` drains them — that drain is what clears Warp's stale "Blocked" badge.」

【源码证实】`rpiv-warp` **完全不使用 `pi.events`**。
【未证实】`package.json` 里的 `"pi": { "ambientObserver": true }` 字段语义：PKG 0.87.1 的 `docs/` 中未检索到该字段说明。

---

## 5 Pi 的事件总线官方语义

### 5.1 类型与实现（本机 0.87.1）

【源码证实】`PKG/dist/core/event-bus.d.ts` 全文：

```ts
export interface EventBus {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
}
export interface EventBusController extends EventBus {
    clear(): void;
}
export declare function createEventBus(): EventBusController;
```

【源码证实】`PKG/dist/core/event-bus.js` 全文（15 行）：

```js
import { EventEmitter } from "node:events";
export function createEventBus() {
    const emitter = new EventEmitter();
    return {
        emit: (channel, data) => { emitter.emit(channel, data); },
        on: (channel, handler) => {
            const safeHandler = async (data) => {
                try { await handler(data); }
                catch (err) { console.error(`Event handler error (${channel}):`, err); }
            };
            emitter.on(channel, safeHandler);
            return () => emitter.off(channel, safeHandler);
        },
        clear: () => { emitter.removeAllListeners(); },
    };
}
```

【源码证实】`PKG/dist/core/extensions/types.d.ts:1158`（`ExtensionAPI` 成员）：

```ts
    /** Shared event bus for extension communication. */
    events: EventBus;
```

【源码证实】`PKG/dist/core/extensions/types.d.ts:1312`（注释在 `:1311`）：

```ts
    /** Retain an event-bus subscription until this runtime is invalidated. */
    trackEventBusSubscription: (unsubscribe: () => void) => () => void;
```

【源码证实】`PKG/dist/core/extensions/loader.js:110` `const eventBusUnsubscribers = new Set();` —— runtime 在失效/reload 时统一退订。
【文档证实】`PKG/docs/extensions.md`（表格行）：「| Communicate with another extension | `pi.events` |」；同页只有一句「Use the exported declarations in `extensions/types.ts` for exact event, context, tool, and result types.」

### 5.2 逐条回答官方语义

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 作用 | **同进程内跨扩展通信**。注释原文「Shared event bus for extension communication.」 | 【源码证实】`types.d.ts:1158` |
| 能否跨进程 | **不能**。实现是 `node:events` 的 `EventEmitter`，`emit(channel, data)` 直接把对象引用传下去，没有任何序列化层 | 【源码证实】`event-bus.js:3`；【源码推断】跨进程需自行 JSON 序列化 + 其它传输 |
| 生命周期 / clear 语义 | 有 `clear()`，语义是 `emitter.removeAllListeners()`（清**所有 channel 的所有监听者**），在 `EventBusController` 上而不是 `EventBus` 上；扩展侧拿到的只是 `EventBus`，因此扩展**无法调用 clear** | 【源码证实】`event-bus.d.ts:5-8`、`event-bus.js:12` |
| 订阅者清理 | 两种：`on()` 返回退订函数；runtime 侧 `trackEventBusSubscription()` 在 runtime 失效时统一退订 | 【源码证实】`event-bus.js:11`、`types.d.ts:1311-1312`、`loader.js:110` |
| 错误隔离 | **有**。handler 被包成 `async safeHandler`，抛错时 `console.error("Event handler error (<channel>):", err)`，**不会**冒泡到 emit 方 | 【源码证实】`event-bus.js:6-10` |
| 订阅者上限 | 源码**没有**设置上限、也**没有**调用 `setMaxListeners`。因此走 Node `EventEmitter` 的默认值（同一事件名 >10 个监听者时 Node 打印 `MaxListenersExceededWarning`） | 【源码证实】`event-bus.js` 全文无 `setMaxListeners`；【源码推断】上限行为继承 Node 默认 |
| emit 的返回值 / 等待 | `emit` 返回 `void`，**不等待** handler。handler 是 async，但 emit 是 fire-and-forget；`safeHandler` 返回的 Promise 未被 await | 【源码证实】`event-bus.js:4-5` |
| 官方稳定性承诺 | PKG 0.87.1 的文档中**未找到**对自定义 channel 命名或语义版本的稳定性承诺 | 【未证实】 |

### 5.3 最小可用示例（发布方 / 订阅方）

发布方（3 行）：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.events.emit("my-guard:approval-waiting", { tool: "bash", command: "rm -rf /", active: true });
}
```

订阅方（5 行）：

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const off = pi.events.on("my-guard:approval-waiting", (data) => {
    const payload = data as { active?: boolean; command?: string };
    if (payload.active) console.error(`waiting on human: ${payload.command}`);  // 这里换成你自己的通知
  });
  // 可选：在 session_shutdown 里 off()
}
```

【源码证实】官方同形示例见 `PKG/examples/extensions/event-bus.ts:21`（`pi.events.on("my:notification", ...)`）与 `:31,38`（`pi.events.emit("my:notification", {...})`）；文件头注释「Shows pi.events for communication between extensions.」

### 5.4 附带发现：宿主已有 `ui_prompt_start` / `ui_prompt_end`（**对 pi-guard 影响最大的一条**）

本轮在 PKG 0.87.1 里找到一个**第一方**的「Pi 正在等人类回答」生命周期事件。

【源码证实】`PKG/dist/core/extensions/types.d.ts:627-641`：

```ts
export type UIPromptKind = "select" | "confirm" | "input" | "editor" | "custom";
/** Fired when Pi starts waiting on a blocking user-facing extension UI prompt. */
export interface UIPromptStartEvent {
    type: "ui_prompt_start";
    reason: "ui_prompt";
    kind: UIPromptKind;
    title?: string;
}
/** Fired when Pi is no longer waiting on a blocking user-facing extension UI prompt. */
export interface UIPromptEndEvent {
    type: "ui_prompt_end";
    reason: "ui_prompt";
    kind: UIPromptKind;
    title?: string;
}
```

【源码证实】`types.d.ts:1002-1003` 注册重载：

```ts
    on(event: "ui_prompt_start", handler: ExtensionHandler<UIPromptStartEvent>): () => void;
    on(event: "ui_prompt_end", handler: ExtensionHandler<UIPromptEndEvent>): () => void;
```

【源码证实】实现机制在本机 `PKG/dist/core/extensions/runner.d.ts` 可见：`:108` `private uiPromptDepth;`、`:109` `private activeUIPrompt;`、`:118` `private wrapUIPromptContext;`、`:119` `private withUIPrompt;`、`:120` `private emitUIPromptEvent;`。
【源码证实·同版本远端文件抽取】`PKG/dist/core/extensions/runner.js`（同版本，经 jsdelivr 取回并由模型抽取，**未在本机逐字复核该 .js 文件**）显示 `withUIPrompt` 包装了 `select` / `confirm` / `input` / `editor` / **`custom`** 五个 UI 方法，并且只在最外层 prompt 时发 start/end（`uiPromptDepth === 0`），通过 `queueMicrotask` 异步派发；`custom` 传的 `title` 是 `undefined`（因此 payload 里不带 `title` 字段）。

对本仓库的含义（【源码推断】）：**pi-guard 只要是通过 `ctx.ui.*`（`select` / `confirm` / `custom`）弹审批对话框，Pi 自身就会替它发 `ui_prompt_start` / `ui_prompt_end`。** 也就是说，「危险命令正在等人确认」这个事实**已经**在宿主层被广播了，任何第三方通知插件都能订阅，**pi-guard 不需要为此改动一行代码**。

【源码证实】生态里已有人这么做：`@yuru7/pi-native-notify` 的 `pi.on("ui_prompt_start", ...)` 与 `@oai404iao/pi-telegram-notify` 的 `pi.on("ui_prompt_start", ...)`（见 §6）。
【文档证实】但本机 `PKG/docs/extensions.md` **完全没提** `ui_prompt_start`；`pi.dev/docs/latest/extensions` 正文也未列出它。这是一个「类型里有、文档里没有」的 API（见 §9）。

---

## 6 生态横评：「通知用户」这件事在 Pi 生态里各怎么做

分类维度：**检测方式** × **发声方式**。

### A. 只写终端级信号（无进程、无网络）

| 包 | 检测 | 发声 | 证据 |
| --- | --- | --- | --- |
| `@juicesharp/rpiv-ask-user-question` 2.11.0 | 工具内部 | **stdout BEL (+ `isTTY`)**，恰好一个 | 【源码证实】§1 |
| `@juicesharp/rpiv-warp` 2.11.0 | `pi.on("tool_call")` + blocking tool 名单 | **OSC 777 / OSC 0 / CSI 22;0t / 23;0t**，Unix 走 `/dev/tty` | 【源码证实】§4 |
| `@zzxb/pi-notify` 0.0.1 | — | `terminal-signals.ts:3` `TERMINAL_BELL = "\x07"`、`:1-2` `"\x1b[22;0t"` / `"\x1b[23;0t"` 标题栈 push/pop；`supportsWindowsTerminalSignals()` 门控 = `platform === "win32" && isTTY && WT_SESSION` 非空 | 【源码证实】（unpkg 取源码） |

### B. OSC 通知（终端模拟器级）

| 包 | 做法 | 证据 |
| --- | --- | --- |
| `rpiv-warp` 2.11.0 | OSC 777 结构化 cli-agent 通知，**仅 Warp 终端** | 【源码证实】§4 |
| `pi-tmux-notify` 0.0.3 | npm description：「Desktop notifications (OSC 777/99/9) when pi finishes work, with tmux pane-return on notification click」，keywords 含 `osc777` | 【文档证实】npm registry（未读源码） |
| `ferologics/pi-notify` | 搜索结果摘要称其「sends desktop notifications via OSC」（OSC 9 在 Ghostty 文档中被列为「Show Desktop Notification」） | 【未证实】本轮未读其源码 |

### C. 自己 spawn / 调用系统通知（与 pi-guard 现状同类）

| 包 | 后端 |
| --- | --- |
| `@pi-unipi/notify` 2.20.5 | `node-notifier`（Windows SnoreToast / macOS terminal-notifier / Linux notify-send+libnotify）+ Gotify + Telegram + ntfy |
| `@yuru7/pi-native-notify` 0.4.0 | `extensions/notifiers/{windows,macos,linux}.ts` 三个平台实现；Windows 走 PowerShell helper |
| `@raidou/pi-notify` 0.7.3 | 「Desktop notification extension for the pi coding agent」（keywords 含 `wsl`） |
| `@diegopetrucci/pi-notify` 0.1.18 | 「sends a notification when the agent is ready for input」 |
| `@leo-alvarenga/pi-notify` 0.2.11 | 「Desktop notification + sound ... D-Bus popup on Linux, opt-in」 |
| `@xyzensun/pi-notify` 3.0.0 | ntfy push（「works anywhere (local, VM, headless server)」） |
| `@pi-lab/notify` 0.0.5 / `pi-idle-notify` 0.3.1 / `@agimon-ai/doompi-notification` / `@gamaraan/todos-tool`（可选）/ `pi-feishu-notify` 0.6.0 | 各自系统/远程后端 |
| **`pi-guard`（本仓库）** | `notify.ts` 降级链：`terminal-notifier` → `osascript` → `afplay` → `notify-send` → `gdbus`，最后兜底 `process.stdout.write("\x07")` |

【源码证实】pi-guard 现状（`GUARD/src/notify.ts`）：`:1` `import { spawn } from "node:child_process";`；`:55/:66/:80/:88/:92` 五个候选 bin；`:191` `spawn(command.bin, command.args, { stdio: "ignore", detached: true, windowsHide: true })`；`:209-212` `ringBellOnStdout()` → `process.stdout.write("\x07")`，注释「最后兜底：向终端写一个 BEL，单字节且不可打印，不会破坏 TUI 渲染」。

### D. 发布事件让别人消费（producer）

| 生产者 | channel | 说明 |
| --- | --- | --- |
| `@juicesharp/rpiv-ask-user-question` 2.11.0 | `rpiv:ask-user:prompt`、`rpiv:ask-user:blocked` | 【源码证实】§2。**blocked 未文档化** |
| **`@gotgenes/pi-permission-system` 33.0.8** | `permissions:ready`、**`permissions:ui_prompt`**、`permissions:decision` | 【文档证实】`docs/cross-extension-api.md`「Event Bus / Channel Reference」表 |
| herdr 生态（如 `@andrewjacop/pi-herdr`、`pi-herdr-*` 系列） | `herdr:blocked` | 【文档证实】UniPi 源码注释 + herdr 文档检索结果；【未证实】我未读 herdr 侧源码 |
| UniPi 自身 | `unipi:*`（如 `UNIPI_EVENTS.ASK_USER_PROMPT`、`WORKFLOW_END`、`NOTIFICATION_SENT`…） | 【源码证实】UniPi `events.ts` |

**`@gotgenes/pi-permission-system` 的 `permissions:ui_prompt` 是本调研最强的生态先例**（与 pi-guard 同类：权限/审批守卫）。`docs/cross-extension-api.md` 原文：

> The permission system emits `permissions:ui_prompt` **immediately before it invokes the active user-facing permission UI**. **This event is for integrations such as notification extensions that should alert only when the user needs to respond to a permission prompt.** It is not a generic "permission request entered waiting state" event, and it does not imply the prompt will be approved.

它同时给出了：稳定性承诺（「Fields may be added to any payload, but existing fields will not be removed or renamed without a semver-major version bump」）、按语义分层的 payload（`surface`/`value` 显示投影 + `request` 事实核心 + `forwarding` 转发上下文）、以及「提示结束」的配对信号 `permissions:decision`（原文：「so a consumer that reacts to this event has a signal on the same bus telling it the prompt is over」）。它还处理了**队列化**这个细节：原文「Asks are presented one at a time: the host holds a single inline dialog slot, so a session that raises a second ask while one is still open queues it rather than mounting over the first. **The event marks the moment the queued ask is presented**, not the moment it was raised」。

### E. 消费事件（consumer）

| 消费者 | 订阅的 channel | 证据 |
| --- | --- | --- |
| `@pi-unipi/notify` 2.20.5 | `rpiv:ask-user:prompt`（专用块）、`permissions:ui_prompt`（经 `BUILTIN_EVENTS.permission_request` 通用循环）、`herdr:blocked`（仅用于收起 re-notify）、`unipi:*`、宿主 `agent_end`/`agent_settled`/`session_shutdown` | 【源码证实】§3.2 |
| `@jetserge/pi-telegram-ask-mirror` 0.1.0 | **不订阅**，改为包装 `ask_user_question` 工具，把问卷镜像到 Telegram inline keyboard（「First surface to answer wins」）；文件头明说 rpiv 事件「one-way, with no channel to send an answer back」 | 【源码证实】unpkg 取源码 |

### F. 依赖宿主生命周期事件（不自己造检测）

| 包 | 做法 |
| --- | --- |
| `@yuru7/pi-native-notify` 0.4.0 | `pi.on("ui_prompt_start")` → 若终端未聚焦则发系统通知；阈值 `thresholdSeconds`；`agent_settled` 也通知 |
| `@oai404iao/pi-telegram-notify` 0.4.0 | `pi.on("ui_prompt_start")` → 发 Telegram 「waiting」；`agent_settled` → 解析最后一条 assistant 消息定 completed/error |
| `@sherif-fanous/pi-notification-center` 0.2.1 | **另一条路**：包装 `ctx.ui.notify`。源码注释原文：「Owns the wrapper installed over the shared extension `ctx.ui.notify` function… **Pi exposes no notification event or middleware hook**, so the only available seam is the shared mutable `ExtensionUIContext`」 |
| `patricktree/pi-vscode-terminal-notify`（VS Code 扩展） | 【未证实】机制未读源码 |

【源码推断·重要】上表 F 说明生态里**已经存在**「订阅宿主 `ui_prompt_start` 就得到全部阻塞提示」的通用通知插件（至少两个）。它们**不关心**是哪个扩展在弹窗——RPIV 的问卷、pi-guard 的审批、任何 `ctx.ui.*` 调用，对它们来说都是同一个 `ui_prompt_start`。

---

## 7 对 pi-guard 的含义：架构对比与可选方向

### 7.1 三种路线并排

| | pi-guard 现状 | RPIV 先例 | `pi-permission-system` 先例 | 宿主 `ui_prompt_start` |
| --- | --- | --- | --- | --- |
| 检测「正在等人」 | 自己判定（guard policy 命中） | 自己判定（工具被调用） | 自己判定（gate 判定为 ask） | **宿主替所有扩展判定** |
| 发声 | `spawn` 5 条候选命令 + BEL 兜底 | stdout BEL（1 字节） | **什么都不发**，只发事件 | 什么都不发，只发事件 |
| 系统级通知由谁做 | pi-guard 自己 | 第三方（UniPi） | 第三方（UniPi） | 第三方（pi-native-notify / pi-telegram-notify…） |
| 生态里有无现成消费者 | 不适用 | 有 1 个（默认关闭） | 有 1 个（默认关闭） | 有 2 个（机制已上线） |
| BEL 兜底 | `process.stdout.write("\x07")`，**无 `isTTY` 门控** | `isTTY` 门控 | 无 | 无 |

【源码证实】一个可直接对比的差异：pi-guard 的 `ringBellOnStdout()`（`GUARD/src/notify.ts:210-212`）**没有** `process.stdout.isTTY` 判断，RPIV 的 `emitTerminalAttention()`（`RPIV/ask-user-question.ts:99`）有。RPIV 注释给出的理由（`:92-95`）正是「不污染管道/重定向输出」。

### 7.2 可选方向

> 以下只列选项与代价，不替使用者做选择。

#### (a) 保持现状（自备 spawn 降级链）

- **解决了什么**：零外部依赖、零生态前置条件；在 macOS / Linux 上成功路径最短（`terminal-notifier` / `osascript` / `notify-send` 直接出系统横幅）；已有 5 级降级 + BEL 兜底，鲁棒。
- **代价**：每个守卫类插件都要重复实现一遍同样的 spawn 链（生态里已有 ≥8 个包在做同一件事，见 §6C）；`spawn` 会把命令名暴露在进程表中；跨平台行为需各自维护。
- **失败模式**：候选命令都不存在时静默退化到 BEL（而 BEL 在很多终端默认关闭或不可闻）；`detached: true` + `unref()` 下通知成功与否只能靠退出码（`GUARD/src/notify.ts:187-205`）；无 `isTTY` 门控时 BEL 可能污染被重定向的 stdout。
- **前置条件**：无。

#### (b) 借鉴 BEL 门控（只是它已有的最后兜底，收益有限）

- **解决了什么**：给现有 BEL 兜底加 `process.stdout.isTTY` 判断，避免在管道/重定向/RPC 场景往 stdout 写字节；照抄 RPIV 的注释理由即可。
- **代价**：约 1 行改动 + 1 条注释；不改变「通知由 pi-guard 自己发」这一架构事实。
- **失败模式**：加了门控后，在 RPC 宿主（VS Code pendant / Zed）里 BEL 完全不再写——如果那时 pi-guard 的 spawn 链也失败，就**完全没有**注意力信号了（RPIV 接受这个代价，因为它的定位是「只管 TUI」；pi-guard 是否接受需要单独判断）。
- **前置条件**：无。**收益上限就是「不污染管道」，不解决跨设备/后台场景。**

#### (c) 把「危险命令待确认」发布成公开事件（`pi.events.emit`），由独立通知插件消费，pi-guard 不再自己发系统通知

- **解决了什么**：职责分离；用户可自行组合后端（系统横幅 / Telegram / ntfy / 手机推送）；落在 Pi 既有的扩展间通信面上（`types.d.ts:1158`）；`@gotgenes/pi-permission-system` 已证明这条路在 Pi 生态里**可行且有文档化规范**（§6D）。
- **代价**：pi-guard 要对一个**没有宿主级稳定性保证**的 channel 做出长期承诺（PKG 文档对自定义 channel 无稳定性声明，见 §9）；要定义并冻结 payload；要维护 STABILITY POLICY 一类的契约文档；一旦某天想收回「自己发通知」的能力，会造成行为倒退。
- **失败模式**：
  1. **没人订阅** = 静默失效。这正是 `rpiv:ask-user:blocked` 的现状（§3.5）——事件发了，零消费者。若 pi-guard 把系统通知删掉只发事件，默认安装的用户会**彻底收不到通知**。
  2. 现有消费者覆盖面很窄：唯一订阅 `rpiv:ask-user:prompt` 的 UniPi 把该事件**默认关闭**；`permissions:ui_prompt` 在 UniPi 里同样默认关闭（`settings.ts:31,33` 两项均 `enabled: false`）。
  3. 通知插件与 pi-guard 的装载顺序/存在性不确定；事件是 fire-and-forget（`event-bus.js:4-5`），pi-guard 无法知道是否有人收到。
- **前置条件（关键）**：**需要先确认生态里是否已有可直接订阅的「危险命令待确认」类事件消费方。** 本轮检索结果：`@pi-unipi/notify`、`@yuru7/pi-native-notify`、`@oai404iao/pi-telegram-notify`、`@pi-unipi/notify` 等**都不订阅任何 pi-guard 命名空间的事件**；它们订阅的是 `rpiv:ask-user:prompt`、`permissions:ui_prompt`、`herdr:blocked`、`ui_prompt_start`。**也就是说：截至调研，生态里不存在一个「订阅 pi-guard 事件」的现成通知插件。** 如果采用 (c)，配套必须显式解决「消费者从哪来」（自建配套插件 / 说服既有插件加入订阅 / 走 (e)）。
- **可复用的具体设计参考**：`@gotgenes/pi-permission-system/docs/cross-extension-api.md` 的 `permissions:ui_prompt` 一节给出了「只在真的要问人时才发」「发 payload 的显示投影 + 事实核心」「配对一条结束事件」「按语义版本做加性承诺」这一整套可比对的做法（§6D）。

#### (d) 仿 rpiv-warp 的 OSC / `/dev/tty` 传输，由专用插件写终端模拟器级通知

- **解决了什么**：终端级富通知（Warp 的 badge/toast、tmux 的 pane 高亮、Ghostty/iTerm 的标题与系统通知），延迟最低（无进程、无网络）；写 `/dev/tty` 可绕开 Pi TUI 的 stdout 差量渲染（§4.3）。
- **代价**：终端模拟器碎片化——`rpiv-warp` 的 OSC 777 只有 Warp 认，且它**在非 Warp 终端下直接 `return`，整个扩展等于不存在**（`index.ts` 的 `if (!warp.isWarp || !warp.supportsStructured) return;`）；`/dev/tty` 丢失 `isTTY` 语义（RPIV 的注释专门批评了这点）；需要为每个终端各写一份协议探测与降级；如果要显示「哪个命令在等人」这类动态内容，还得处理 OSC 注入/转义（命令文本里含 `ESC`/`BEL` 怎么办）。
- **失败模式**：终端不识别 → 序列被打到屏幕上（可见乱码）或被静默吞掉；`/dev/tty` 在无控制终端的场景（daemon / CI / RPC）打不开 → 静默失败；tmux/screen 需要 passthrough 包装才透传 OSC。
- **前置条件**：需要一个**按终端探测 + 分协议发射**的专用网络传输层；`pi-tmux-notify`（OSC 777/99/9 + tmux passthrough）、`rpiv-warp`（`/dev/tty` + ConPTY 回退）、`@zzxb/pi-notify`（`WT_SESSION` 门控 + 标题栈）可作为三种起点参考。

#### (e) 组合

组合空间里值得单独指出的一条路线（因为它**不需要 pi-guard 做任何改动**）：

**(e-1) 让 pi-guard 保持现状，另由通知插件订阅宿主的 `ui_prompt_start`。**
- **解决了什么**：Pi 0.87.1 的 `ExtensionRunner.withUIPrompt` 已经包装了 `select`/`confirm`/`input`/`editor`/`custom` 五个 UI 方法（§5.4）。只要 pi-guard 通过 `ctx.ui.*` 弹审批框，宿主就会自动发 `ui_prompt_start`（`kind` 会标出 `confirm`/`select`/`custom`）。生态里已有两个插件在订阅它。
- **代价**：pi-guard 失去了「只在自己的审批框上通知」的精确性——`ui_prompt_start` 是**全局**的，任何扩展弹窗都会触发（不过 payload 里没有「是谁弹的」，无法区分）。
- **失败模式**：① 该事件在 PKG 0.87.1 的 `docs/extensions.md` 与 `pi.dev` 文档中**完全没有记载**（§9），属于「类型里有、文档里没有」的 API，未来存在被改名/移除的风险；② `custom` kind 不带 `title`，通知内容可能拿不到命令文本；③ 依赖用户的 Pi 版本 ≥ 0.87.1。
- **前置条件**：用户需要额外装一个订阅 `ui_prompt_start` 的通知插件（现成可选：`@yuru7/pi-native-notify`、`@oai404iao/pi-telegram-notify`）。

**(e-2) 其余组合的通用形态**：pi-guard 保留自备 spawn 链作为**唯一兜底**（现状不退化），同时**额外**发一个公开事件（(c)）供生态消费；BEL 加 `isTTY` 门控（(b)）。
- **代价**：双轨并存 → 用户可能**收到两次**通知（pi-guard 自己的 + 订阅者的）。需要一个抑制机制（例如「检测到有订阅者就不自发」——但 `EventBus` 没有提供「有没有人订阅」的查询能力，见 §9）。
- **失败模式**：重复通知比不通知更烦人；抑制机制若靠约定而非机制，容易在版本变动中失配。
- **前置条件**：需要先解决「如何知道有人在听」这个问题（当前 `EventBus` 接口只有 `emit`/`on`，无订阅者计数）。

---

## 8 对前一份证据文件（`/tmp/rpiv-attention-evidence.md`）的抽样复核

我按任务要求对其中的关键 `file:line` / 命令输出抽样复核了 **11 组**（远超要求的 5 条）。

### 8.1 复核通过（10 组）

| # | 证据文件的主张 | 我的复核 | 结论 |
| --- | --- | --- | --- |
| 1 | `ask-user-question.ts:87-102` 的 BEL 全文 | 逐行比对，含 `:88` `export const BEL = "\x07";`、`:99` `if (process.stdout.isTTY) process.stdout.write(BEL);` | ✅ 完全一致 |
| 2 | `ask-user-question.ts:66 / 371` 两个 `emitTerminalAttention` 调用点，`:369` blocked(true) | offset 读取确认 `:66`、`:369`、`:371` 精确对位（`:370` = `try {`，`:372` = `ctx.ui.custom`） | ✅ 完全一致 |
| 3 | `events.ts:22` / `:33` channel 常量、`:1-19` STABILITY POLICY、`:24-26` / `:35-38` / `:40-52` / `:54-59` payload 接口 | offset 读取逐条确认（文件共 59 行，与我的逐行计数一致） | ✅ 完全一致 |
| 4 | `docs/hosts.md:16` / `:18` 两段原文 | offset=14 读取确认 `:14`=标题、`:16`=BEL 段、`:18`=best-effort 段 | ✅ 完全一致 |
| 5 | `README.md:30` BEL 段落 | offset=20 读取确认 `:30` 正是该段 | ✅ 完全一致 |
| 6 | `config.ts:4,5,9-16,77-79` | 全文逐行确认 | ✅ 完全一致 |
| 7 | pi-guard `notify.ts:191` spawn、`:209-211` BEL 兜底 | offset=180 读取确认 `:191` = `const child = spawn(...)`、`:209` = 注释、`:210-212` = `ringBellOnStdout()` 与 `process.stdout.write("\x07")`。证据文件写 `:209-211`，实际写入语句在 `:211`、函数体终于 `:212` | ✅ 实质一致（区间尾巴差 1 行，不影响结论） |
| 8 | PKG `event-bus.d.ts` 全文、`types.d.ts:1158` `events: EventBus;`、`:1312` `trackEventBusSubscription` | offset 读取逐行确认（`types.d.ts` 共 1432 行） | ✅ 完全一致 |
| 9 | rpiv-warp 的 OSC 常量与 `/dev/tty` 传输（来自 `/tmp/rpiv-warp-unpacked`） | 我**换源独立复核**：直接读 npm 发布 tarball（unpkg）的 `warp-notify.ts` / `index.ts`，常量、`TTY_PATH`、`writeRaw`、Windows 回退、`isWarp` 门控、`blockingTools.has(event.toolName)` 全部对上 | ✅ 完全一致（且换源交叉验证） |
| 10 | UniPi 是 `rpiv:ask-user:prompt` 消费者（来自 `/tmp/unipi-notify`） | 我**换源独立复核**：读 unpx 上 `@pi-unipi/notify@2.20.5` 的 `events.ts` / `ask-user-prompt-message.ts` / `settings.ts`，`events.ts:21-24`、`224-237`、`241-246`、`settings.ts:31` 全部对上 | ✅ 完全一致（且换源交叉验证） |

### 8.2 复核发现的不符（1 组，必须纠正）

| # | 证据文件的主张 | 实测 | 处理 |
| --- | --- | --- | --- |
| 11 | ❌ `RPIV/index.ts:48-56 重新导出两个常量与四个类型`、`index.ts:58-61 默认工厂`、`index.ts:26-30 动态 import 注册 locale` | **本机 `index.ts` 只有 54 行**，三处引用全部越界或不符。实测：动态 import 的 `try {` 在 **`:35`**、`sdk.registerLocalesFromDir(...)` 在 `:37`；重导出的 `export {` 块在 **`:42-49`**；默认工厂在 **`:51-54`** | ❌ 已纠正。可能是引用了 GitHub 仓库版本（`rpiv-mono/packages/rpiv-ask-user-question/index.ts`）而非本机安装版本，也可能只是行号估计。**本报告一律以本机实测行号为准**（`RPIV/index.ts:42-49`、`51-54`） |

### 8.3 我另外补充的、证据文件未覆盖的内容

1. **§5.4 宿主 `ui_prompt_start` / `ui_prompt_end`**（`types.d.ts:627-641`、`:1002-1003`；`runner.d.ts:108-120`）——证据文件完全没有覆盖，而这可能是对 pi-guard 最重要的一条。
2. **§3.3 起源 PR #39**（含动机原文与「first `rpiv:*` event」的维护者表述）——证据文件只列了「未证实」项。
3. **§3.4 rpiv-warp 不订阅 rpiv 事件**（换源复核坐实）。
4. **§6D `@gotgenes/pi-permission-system` 的 `permissions:ui_prompt`**——证据文件未提及这个与 pi-guard 最同类的先例。
5. **§2.3 契约缺口**：`docs/tool-schema.md` 只文档化 prompt，未文档化 blocked。
6. **§6A/§6F `@zzxb/pi-notify` 的 BEL 门控写法**与**两个订阅 `ui_prompt_start` 的插件**。

---

## 9 未证实项与检索局限

**检索局限（影响结论强度，必须随结论一起引用）**

1. **GitHub code search 需登录**：`github.com/search?q="rpiv:ask-user:blocked"&type=code` 返回「Sign in to search code on GitHub」。
2. **grep.app 持续 429**：4 次不同查询（`rpiv:ask-user`、`rpiv:ask-user:blocked`、`rpiv:ask-user:prompt`、`ask-user:blocked`）全部 `HTTP 429 Too Many Requests`，跨多个回合仍失败。
3. **Sourcegraph 公共搜索 403 Forbidden**；**searchcode.com API 404**（端点已下线）。
4. 因此 §3.5 的结论**只能表述为「截至调研未发现消费者」**，不能表述为「已证明不存在消费者」。任何仓库内的私有代码、未被 npm 发布的本地插件、或 GitHub 上未被搜索引擎收录的仓库都不在覆盖范围内。

**未证实的具体条目**

1. 【未证实】`RPIV/events.ts:19` 引用的「Pi's `"my-extension:status"` example」在本机 PKG 0.87.1 的 `docs/`、`examples/` 中均未检索到（只找到 `examples/extensions/event-bus.ts` 的 `"my:notification"`）。
2. 【未证实】PKG 0.87.1 文档中**没有**对 `pi.events` 自定义 channel 的命名或稳定性承诺。
3. 【未证实】`ui_prompt_start` / `ui_prompt_end` 未出现在本机 `PKG/docs/extensions.md`，也未出现在 `pi.dev/docs/latest/extensions` 正文。**它是「类型里有、文档里没有」的 API**（`types.d.ts:627-641`、`:1002-1003` 为确凿源码证据）。其「无文档 = 不稳定」的风险无法从本机资料判断。
4. 【未证实·部分复核】`runner.js` 中 `withUIPrompt` 的具体代码（包装 5 个 UI 方法、`uiPromptDepth === 0` 才发、`queueMicrotask` 异步派发、`custom` 不带 title）来自**同版本远端文件经模型抽取**，我**没有在本机逐字复核该 `.js` 文件**；但本机 `runner.d.ts:108-120` 的 `uiPromptDepth` / `activeUIPrompt` / `wrapUIPromptContext` / `withUIPrompt` / `emitUIPromptEvent` 五个私有成员独立佐证了该机制存在。
5. 【未证实】`@juicesharp/rpiv-warp` 的 `package.json` 中 `"pi": { "ambientObserver": true }` 字段语义——PKG 0.87.1 文档中未检索到。
6. 【未证实】UniPi 为什么监听 `herdr:blocked` 而不是 `rpiv:ask-user:blocked`（源码注释、README、PR 均未说明）。
7. 【未证实】RPIV 是否在 CHANGELOG / issue 中解释过「为什么不做系统通知」——本轮未读其 CHANGELOG 与仓库 issue 列表（只读了 PR #39）。
8. 【未证实】RPIV 的 BEL 在 Windows 上的实际表现。源码只写 `process.stdout.write`，**无任何平台分支**；是否响铃取决于终端/ConPTY，本机无法验证。
9. 【未证实】`pi-chime`、`pi-focus-bell`、`ferologics/pi-notify`、`pi-tmux-notify`、`patricktree/pi-vscode-terminal-notify` 的具体实现机制——本轮只读到 npm 描述与搜索摘要，未读源码。§6B 因此把它们标为低置信度。
10. 【未证实】`pi.dev` 包页是否列出「依赖/使用了本包的插件」——`pi.dev/packages/@juicesharp/rpiv-ask-user-question` 页面（本轮已抓取全文）**没有**任何 consumers/dependents 区块。
11. 【未证实】npm registry search 对 `rpiv:ask-user` 的返回是**描述文本匹配**而非源码匹配，所以它**不能**用来证明「不存在只在源码里出现的消费者」；我在 §3.6 已如实标注。

---

## 10 来源

### Kept（主源，按优先级）

**本机已安装源码（最高优先级）**
- RPIV `ask-user-question.ts`、`events.ts`、`index.ts`、`config.ts`、`package.json`、`README.md`、`docs/hosts.md`、`docs/tool-schema.md` — `/Users/lystran/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question/` — 被调研对象的唯一权威源
- PKG `dist/core/event-bus.d.ts`、`dist/core/event-bus.js`、`dist/core/extensions/types.d.ts`（1432 行）、`dist/core/extensions/runner.d.ts`（194 行）、`dist/core/extensions/loader.js`、`docs/extensions.md`、`examples/extensions/event-bus.ts` — Pi 0.87.1 的公开 API 与实现
- GUARD `src/notify.ts` — 本仓库对照组

**npm 已发布 tarball（换源独立复核）**
- `https://unpkg.com/@juicesharp/rpiv-warp@2.11.0/warp-notify.ts`、`/index.ts` — OSC/`dev/tty` 传输的一手实现
- `https://unpkg.com/@pi-unipi/notify@2.20.5/events.ts`、`/ask-user-prompt-message.ts`、`/settings.ts` — **唯一消费者**的一手实现
- `https://unpkg.com/@yuru7/pi-native-notify@0.4.0/extensions/index.ts` — 订阅 `ui_prompt_start` 的一手实现
- `https://unpkg.com/@oai404iao/pi-telegram-notify@0.4.0/src/index.ts` — 同上
- `https://unpkg.com/@zzxb/pi-notify@0.0.1/terminal-signals.ts` — BEL + 标题栈 + `WT_SESSION` 门控的一手实现
- `https://unpkg.com/@jetserge/pi-telegram-ask-mirror@0.1.0/index.ts` — 第三方对 rpiv 事件契约的**评价**（one-way、无回传通道）
- `https://unpkg.com/@gotgenes/pi-permission-system@33.0.8/docs/cross-extension-api.md`、`/src/service/permission-ui-prompt.ts` — 与 pi-guard 最同类的权限守卫的事件化先例

**官方文档 / registry**
- `https://pi.dev/docs/latest/extensions` — Pi 官方扩展文档（`pi.events` 一行说明；未提 `ui_prompt_start`）
- npm registry search API（`registry.npmjs.org/-/v1/search`，4 组查询）— 生态横评的包清单
- `https://pi.dev/packages/@juicesharp/rpiv-ask-user-question` — 包页（2.11.0，203.7K/mo，无 consumers 区块）

**PR（动机的一手证据）**
- `https://github.com/juicesharp/rpiv-mono/pull/39` — 事件起源、指名消费者、维护者对契约的评审意见

### Rejected / Deprioritized

- **二手博客 / 汇总文章**（`weblog.masukomi.org`、`composio.dev/top-pi-extensions`、`deepakness.com`、`daily.dev`、`developersdigest.tech` 等）——SEO 味重、无一手细节，仅用于发现包名，未用于任何结论
- **YouTube / Reddit / X 帖子**——不可引用，只用于发现包名
- **npm registry search 的「描述匹配」结果**——不能作为「存在/不存在消费者」的证据（已在 §3.6 标注该局限）
- **`pi-chime`、`pi-focus-bell`、`ferologics/pi-notify`、`pi-tmux-notify`** ——只拿到描述文本，未读源码，在 §6 中已标为低置信度
- **`searchcode.com` API / `sourcegraph.com` / `grep.app`** —— 端点下线 / 403 / 429，未取得任何数据
- **`github.com` code search** —— 登录墙，未取得数据

---

## 11 后续建议（只列最有用的几条）

1. **确认 `ui_prompt_start` 的稳定性**：`types.d.ts:627-641` / `:1002-1003` 是硬证据，但本机 docs 与 pi.dev 文档都没有它。若要把它作为 pi-guard 的前置依赖，值得向 Pi 维护者确认它是否属于承诺稳定的公开 API，以及 `custom` kind 为何不带 `title`。
2. **补一次代码级全网检索**：等 grep.app 限流恢复后，用 `rpiv:ask-user:blocked`、`permissions:ui_prompt`、`ui_prompt_start` 各跑一次，确认 §3.5 的「未发现消费者」是否成立。这是本轮唯一因为工具受阻而无法收敛的结论。
3. **直接读 `@gotgenes/pi-permission-system` 的 `src/service/permission-events.ts`**（9.3KB）：它把「发布 + 配对 + 稳定性承诺 + 队列化语义」做成了可复制的模板，比 RPIV 的 90 行 `events.ts` 信息量大得多。
4. **实测 Pi 是否真的为 pi-guard 的对话框发 `ui_prompt_start`**：这决定了方向 (e-1) 是否零改动可行。可用一个几行的临时扩展订阅该事件、然后触发一次 pi-guard 审批来验证（属运行时验证，本轮被禁止执行）。
5. **判断是否需要「有订阅者是才自发通知」的机制**：当前 `EventBus` 接口（`event-bus.d.ts`）只有 `emit` / `on`，**没有**订阅者计数或查询能力。若走 (e-2) 组合路线，这个缺口必须先解决。
6. **不要依赖 `rpiv:ask-user:blocked`**：它既未文档化（§2.3），也未发现消费者（§3.5），参考价值仅限于「命名与 active 配对的形状」。

---

## 12 主代理补充核实（2026-09-23，由主代理亲手执行）

本节修正/补强正文中的三处论断，来源为**主代理自己运行的命令与抓取的原文**，不依赖任何子代理的转述。

### 12.1 修正：§5.4/§9 的「文档里没有」需要更精确的表述

> 原文主张：`ui_prompt_start` 在 0.87.1 的 `docs/extensions.md` 与 pi.dev 文档中完全没有记载，属「类型里有、文档里没有」的 API。

**核实结果：结论成立，但原因是「整份扩展参考被移出 npm 包」，而不是这个事件被特意隐藏。**

| 事实 | 证据 |
|---|---|
| 0.87.0 的 `docs/extensions.md` **有**该事件的完整小节（标题 `#### ui_prompt_start / ui_prompt_end`，含示例与「coalesced into one outer waiting span」「not awaited」两条语义） | `.../@earendil-works+pi-coding-agent@0.87.0/.../docs/extensions.md:608-626` |
| 0.87.1 的同一文件只剩 **215 行**（0.87.0 为 **3101 行**），全部 `docs/*.md` 合计仅 3345 行 | `wc -l`；0.87.1 `docs/extensions.md` 的 `grep -c ui_prompt` = **0** |
| 官网 `https://pi.dev/docs/latest/extensions` 正文与 215 行版本**逐段一致**，导航中也不存在独立的 events 页面 | 抓取该 URL 全文；`docs/docs.json` 的 Build on Pi 分组只有 extensions / custom-provider / tui / cli-integration |
| 但 `CHANGELOG.md:246` 仍链接到 `docs/extensions.md#ui_prompt_start--ui_prompt_end` —— **悬空锚点** | `grep -n ui_prompt CHANGELOG.md` |
| 该事件仍在类型与运行时中：`types.d.ts:630/637`（事件对象）、`:1002-1003`（`on()` 重载）；`CHANGELOG.md:255` 记录由 PR #8355 引入 | 本机 `grep` |

**对风险判断的影响**：这份文档是「曾经被正式写入参考手册、随后被一次文档重组连带删掉」，比「从未文档化」更能说明它是**有意设计的公开面**；同时，官网「Events and concurrency」一节明文写着 *"Use the exported declarations in [`extensions/types.ts`](...) for exact event, context, tool, and result types"*，即**类型文件本身就是官方指定的契约来源**。悬空的 changelog 链接则是一个独立的文档质量信号。综合起来：稳定性风险仍然存在（无 prose 契约承诺），但「可能随时被移除」的担忧应下调。

### 12.2 证实：§6F 的 (e-1) 路径确实有现成实现，且比 pi-guard 现状更精细

主代理直接抓取 `@yuru7/pi-native-notify@0.4.0` 的入口 `.pi.extensions` 指向的真实文件（`npm view ... pi` → `./extensions/index.ts`）原文，确认：

```ts
pi.on("ui_prompt_start", async (event) => {
  try { await runtime.onPromptStart(event.title); } catch { /* 通知失败不影响 Agent */ }
});
// runtime.onPromptStart: if (!isUnfocused()) return false;   —— 只在终端未聚焦时才发
```

它同时用 `agent_settled` 做「任务完成」通知，并用 `before_agent_start`/`agent_start` 记录耗时以支持 `thresholdSeconds` 阈值。
即：**一个已发布的第三方插件会订阅宿主事件、对所有 `ctx.ui.*` 弹窗（含 pi-guard 的 `confirm`）发原生系统通知，且自带「未聚焦才发」的降噪——pi-guard 无需任何改动即可受益。**

### 12.3 补充：焦点上报（DECSET 1004）在 Pi 里的真实状态

`@yuru7/pi-native-notify` 的 `extensions/focus.ts` 显示它**自己**往 stdout 写 `\x1b[?1004h` 开启焦点上报，并监听 `process.stdin` 的 `\x1b[I`（focus in）/ `\x1b[O`（focus out），另用 `SIGTSTP`/`SIGCONT` 处理 Ctrl-Z 挂起。

而 Pi 自己只在 **alt-screen（全屏）模式** 顺带开启它，且与鼠标追踪捆绑在同一串里：

```js
// @earendil-works/pi-tui/dist/tui-alt-screen.js:15-17
const ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
```

`pi-coding-agent/dist` 中对 `1004` **零匹配**；`docs/*.md` 也完全没有焦点上报的记载。

**结论**：默认（主屏）模式下 Pi 不开焦点上报，插件若要「只在未聚焦时通知」必须自己写 DECSET 序列（与写 OSC 属同一片「公开类型/裸字节、文档未承诺」的灰色地带）。前一份 `pi-guard-notification-os-mechanisms.md` 把焦点感知判为「不做主动探测、交给终端」，应重新理解为**一次取舍**，而不是技术上的不可能。

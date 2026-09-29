# 调研：前台/后台子代理被判危险命令时能否弹确认框（pi-guard × pi-subagents × Pi）

**基线（本轮实际读取核对）**

| 组件 | 版本 | 核对方式 |
| --- | --- | --- |
| Pi / `@earendil-works/pi-coding-agent` | **0.87.1** | 读 `…/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/…/@earendil-works/pi-coding-agent/package.json:3`；npm registry `dist-tags.latest = 0.87.1` |
| pi-subagents | **0.73.1** | `~/.pi/agent/npm/node_modules/pi-subagents/package.json:5` |
| @lystran/pi-guard | **0.5.0** | `~/.pi/agent/npm/node_modules/@lystran/pi-guard/package.json:3`；仓库内 `plugins/pi-guard/package.json:3` 同为 0.5.0 |
| dcg | **0.14.0** | **本轮未复核**（本轮只读、无 bash 工具，无法执行 `dcg --version`）；沿用 scout 证据文件记录，见第 5 节 |

本轮取证方式说明（影响"不存在"类结论的强度）：本轮可用工具只有 `read` / web 检索 / 抓取，**没有 bash/grep/glob**。因此：
- 「源码证实」= 我用 `read`（必要时 offset=N/limit=1 单行定位）在本机文件里逐字读到；
- 「证据文件(未复核)」= 只在两份 scout 证据文件里，本轮未重读；
- 「**不存在**」类结论依赖 scout 的穷尽检索命令 + 本轮我自己的定向通读（pi.dev 文档、Pi CHANGELOG、npm dist-tags、`package.json#exports` 全表、`types.d.ts` 公开面），**不是**我重跑的 grep，强度低于 scout 报告的自我描述。

本机路径别名（下文 `:line` 均基于此）：
- `SUB = /Users/lystran/.pi/agent/npm/node_modules/pi-subagents`
- `PI = /Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-coding-agent`
- `GUARD = /Users/lystran/.pi/agent/npm/node_modules/@lystran/pi-guard`
- 两份 scout 证据文件均存在（`docs/research/evidence-pi-subagents-child-guard-seams.md`、`docs/research/evidence-pi-child-session-ui-api.md`）

---

## 1) 结论摘要

**能否实现：能，但不能依赖任何官方"上抛"机制；必须由 pi-guard 自己建"父侧确认服务 + 子侧请求客户端"，并且前台与后台需要两套不同通道。**

1. **官方支持度 = 零**（Pi 侧）。Pi 0.87.1（= npm 最新版）没有任何"无界面/子会话把 UI 确认请求交给父会话或宿主"的通用机制；官方只给出"能力探测 + 扩展自己降级"的约定（`ctx.hasUI` / `ctx.mode`），唯一"宿主代答"先例是专用的 `project_trust`。**[文档证实 + 源码证实]**
2. **pi-subagents 侧明确表示该路径不支持**。0.73.1 的官方文档原文：自己 `ask` 的仲裁者"returns only `approve` or `deny` and **does not notify the parent**"，并进一步声明前台 `ask` 转发"**remains unsupported until the extension accepts a session-scoped target**"。上游 issue #2010 的验收边界亦写明"Permission arbitration currently explicitly **forbids asking the parent**；do not silently broaden that separate authority-sensitive path"。**[文档证实]**
3. **生态里已有同构先例（第三方实现）**：`@gotgenes/pi-permission-system`（fork 自 MasuRii/pi-permission-system）明确实现"**Forwards prompts from subagents** — `ask` policies work even in non-UI execution contexts, and a forwarded prompt **queues behind** whatever dialog is already open"以及"in-process child sessions register with the permission system automatically, enabling … `ask`-state forwarding to the parent UI **without configuration**"。→ 说明"子会话请求父会话 UI 确认"在 Pi 生态**可做且已有人做**，但那是"配合自家 subagents 包 + 公开事件 seam"的整体设计，**不能直接搬到 nicobailon/pi-subagents + pi-guard 上**。**[文档证实（第三方，非官方）]**
4. **pi-guard 进入子会话这半个问题已有官方公开解法**：`pi-subagents/required-child-extensions` 的 `registerRequiredChildExtensions({ sessionId: <父会话 id>, extensions:[{id,path}] })` 是**公开导出 + 官方文档**，按**父会话 id** 注册，子会话侧在 `child-launch.js:74` 用 `resolveRequiredChildExtensions(input.parentSessionId)` 解析，覆盖前台/后台/嵌套/恢复启动，且能压过 `extensions: []`。→ 父侧 pi-guard 实例可以**不改 pi-subagents** 就把自己塞进所有子会话（含后台 detached）。**[源码证实 + 文档证实]**
5. **推荐路径（P2）**：pi-guard 只在自身内实现
   - 父侧（`hasUI === true` 的实例）成为"确认 broker"，同时服务两种通道；
   - **前台**：同一 Node 进程 → 进程内 broker（`globalThis[Symbol.for("pi-guard.confirm-bridge.v1")]`，纯 JS，无 Pi API 依赖，不依赖 `pi.events`）；
   - **后台**：跨进程 → 文件队列（父会话 id 从 runner 的 `PI_SUBAGENT_PARENT_SESSION` 环境变量取，`async-execution.js:479-482` 源码证实），父侧 pi-guard 轮询请求目录 → `ctx.ui.confirm` → 写回复；子侧带 deadline，超时 fail-closed `deny`；
   - 注入用 P2 的 `registerRequiredChildExtensions`（或退化为 frontmatter `extensions`/settings `subagents.defaultExtensions`）。
   官方支持程度：**注入=官方公开 API；上抛=需自行发明（有生态先例，无官方规范）**。
6. **不推荐的替代**：复用 watchdog `ask` 仲裁通道（P3）**不等于弹框**——它是"子代理 → 一次性 LLM 仲裁者"，无 UI、不通知父会话，且 `permissions` 规则粒度只有工具名、`bash` 被显式排除；`contact_supervisor`（P4）能上抛，但它是给模型的工具、父侧呈现是"消息 + 触发父模型新回合"，拿不到"人点按钮"的布尔答复，且无人应答时阻塞至 10 分钟超时。

**前台子代理能否直接借用父会话 TUI：**
- **实现层面：可行，但只能用非官方手段。** 前台子代理是**父进程内的** `AgentSession`（`SUB/docs/observability.md`：foreground child is a pi session created **inside the parent Pi process**），因此父会话里那个 `hasUI=true` 的 pi-guard 实例与子会话实例处于**同一进程、同一 realm**，可以通过 `globalThis`（或文件）通信；子侧请求 → 父侧实例用**自己持有的真实 `ctx.ui`** 弹框 → 回传布尔值。这不需要子会话"拿到"父 UI 对象。
- **官方 API 层面：不可能。** 扩展侧完全没有暴露 `session` / `bindExtensions` / `setUIContext`（`PI/dist/core/extensions/types.d.ts` 的 `ExtensionAPI` / `ExtensionContext` 公开面），`createAgentSession` 也不接受任何 UI 选项；pi-subagents 调用 `bindExtensions` 时不传 `uiContext`（`SUB/src/runs/shared/child-session.js:291-292`，`mode: "print"`），因此子会话 `ctx.hasUI === false`、`ctx.ui.confirm` 恒 `false`。**pi-subagents 官方文档把"前台 ask 转发"显式列为 unsupported**。
- 唯一"官方 API 级"的前台方案要**改 pi-subagents**（上游）：在 `child-session.js:291` 的 `bindExtensions` 里补一个 `uiContext`（父侧 pi-subagents 扩展自己就有 `ctx.ui`）。这属于"把父 UI 对象借给子会话"，不是"子会话上抛请求"。

**后台 runner 是否只有 rpc 与外部通知两条路：**
- **更准确的说法是"rpc 形式存在但没有对端消费"**。binaryHost（编译版 Pi）路径下 runner 确实是 `pi --mode rpc …` 启动（`SUB/src/runs/background/async-execution.js:462-463`），但它的 stdio 是 `stdio: ["ignore", stdoutFd, stderrFd]`、stdout/stderr 指向日志文件（`async-execution.js:483-487`）→ 没有宿主读 `extension_ui_request`、更没法回 `extension_ui_response`；npm/JS-host 路径下 runner 根本不是 pi 会话而是普通 node 进程（`command = binaryHost ?? nodeExecutable`，`async-execution.js:~428`；args 为 `[preload, runner, cfgPath]`）。且 runner 进程自身用 `--no-extensions` 启动、其内部子会话又是 `mode:"print"` 绑定。
- 所以后台实际可用的是：① **带外通道（文件/HTTP/消息中间件），由父会话一侧主动消费**——这正是 pi-subagents 既有做法（supervisor channel 的 `requests/`+`replies/` 目录、control inbox 的 `steer-requests/`+`stop-requests/` 目录）；② **外部通知**；③ pi-subagents 自有 supervisor/control 通道（面向 LLM 工具或包内部，**未公开导出**，第三方不可复用）。
- 结论：**"只有 rpc 与外部通知"这个前提需要修正为"rpc 事实上没有对端；真正可用的是带外通道 + 外部通知 + 不可公开复用的 pi-subagents 自有通道"**。

---

## 2) 事实清单

### A. Pi 0.87.1 侧（无上抛机制）

**A1. 四种 mode 下扩展都会加载，但 print/json 没有 UI。**
**Sources:** pi.dev 官方文档 <https://pi.dev/docs/latest/extensions>（"Extensions load in interactive, RPC, JSON, and print modes. … RPC can forward supported dialogs and notifications through the RPC Extension UI protocol, but not custom terminal components; JSON and print modes have no UI. Guard terminal-only behavior with `ctx.mode === "tui"` and use `ctx.hasUI` for interactions supported by interactive and RPC clients."）**Support:** 直接证据（官方文档原文）。**Confidence:** high。
**备注：** 同一句是官方对"非交互模式怎么办"的全部指引——**没有**"向上求助"的第三选项。

**A2. `hasUI` 的唯一判定是"注入的 uiContext 是否为内置 no-op"。**
**Sources:** `PI/dist/core/extensions/runner.js:364`（单行复核：`return this.uiContext !== noOpUIContext;`）；`noOpUIContext.confirm = async () => false` 见 `runner.js:132-136`（**证据文件(未复核)**）。**Support:** 直接证据（364）、**证据文件(未复核)**（132-136）。**Confidence:** high。

**A3. `ExtensionMode = "tui" | "rpc" | "json" | "print"`；`ExtensionContext` 有 `ui/mode/hasUI/cwd/sessionManager/model/signal/abort/shutdown`，**没有** session 句柄或 UI 注入点。**
**Sources:** `PI/dist/core/extensions/types.d.ts:209`（单行复核 `export type ExtensionMode = …`）与 `:210-248`（本轮读取确认字段表；`sessionManager: ReadonlySessionManager` 是只读）。**Support:** 直接证据。**Confidence:** high。

**A4. 扩展侧无法自取/改写 UI 上下文（无 `bindExtensions` / `setUIContext` / `session` 暴露）；`createAgentSession` 也不接受 UI 选项。**
**Sources:** scout 证据文件 `evidence-pi-child-session-ui-api.md` Q2b/Q2c（含 `PI/dist/core/sdk.d.ts:10-56`、`agent-session.d.ts:143`、`agent-session.js:2293-2312,2355`）；本轮复核了 `types.d.ts:209-248` 公开面（与 Q2c 一致）。**Support:** **证据文件(未复核)** + 本轮间接一致。**Confidence:** medium-high（公开面已核，具体行号未复核）。

**A5. 唯一"宿主代答"先例是 `project_trust`，且仅限信任场景。**
**Sources:** scout 证据文件 `evidence-pi-child-session-ui-api.md` Q4（`types.d.ts:392-403` `ProjectTrustContext.ui: Pick<ExtensionUIContext,"select"|"confirm"|"input"|"notify">`）。**Support:** **证据文件(未复核)**。**Confidence:** medium。

**A6. 官方 CHANGELOG 到 0.87.1 未有"子会话 UI 上抛"类特性；npm `latest` 就是 0.87.1（不存在更新版本可期待该能力）。**
**Sources:** <https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md> 关键词检索 `uiContext` / `hasUI` / `child session` / `bindExtensions` / `extension UI` / `print mode`（`child session`、`bindExtensions` 零命中；`extension UI` 命中均为 RPC 协议/UI prompt 事件等既有内容，最近相关条目为 0.84.4 "Extension UI prompt events"）；npm registry `dist-tags`: `{"latest":"0.87.1"}`（`https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent`）。**Support:** 直接证据（检索 + registry 原文）。**Confidence:** high（就"最新发布版没有该能力"而言）。
**注意：** 这是*关键词*检索，不是全量语义审查；若官方用了完全不同的命名，可能漏检（见第 5 节）。

**A7. 官方生态惯例是"父会话在启动子会话前先确认"，不是"子会话运行中上抛"。**
**Sources:** scout 证据文件 Q4（`PI/examples/extensions/subagent/index.ts:300` 以 `--mode json -p --no-session` 起子会话；`:523,538` 由父扩展 `ctx.hasUI && await ctx.ui.confirm(...)`）。**Support:** **证据文件(未复核)**。**Confidence:** medium。

### B. pi-subagents 0.73.1 侧

**B1. 两个 host kind 的子会话都由 `createAgentSession` + `bindExtensions({mode:"print"})` 创建，不传 `uiContext`。**
**Sources:** `SUB/src/runs/shared/child-session.js:291`（`await session.bindExtensions({`）与 `:292`（单行复核：`mode: "print",`）；前台走 `host:"parent"`、后台走 `host:"runner"` 见 scout 证据（`execution.js:317`、`runner-child-launch.js:65`）。**Support:** 直接证据（291/292 本轮单行复核）、**证据文件(未复核)**（host 分支行号）。**Confidence:** high。

**B2. 子会话因此 `ctx.hasUI === false`、`ctx.ui.confirm` 恒 `false`（`noOpUIContext`）。**
**Sources:** A2 + B1 的合成。**Support:** 源码推断（由 A2 的判定式与 B1 的实参直接推出，非实测）。**Confidence:** high。

**B3. 前台子代理**永远**不加载 ambient 扩展（`noExtensions` 恒为 true），只能靠显式列出的路径。**
**Sources:** `SUB/src/runs/shared/child-launch.js:187`（单行复核：`const ambientExtensions = input.host === "runner" && !toolPlan.disableAmbientExtensions;`）与 `SUB/src/runs/shared/child-session.js:230`（单行复核：`noExtensions: !launch.ambientExtensions,`）。**Support:** 直接证据。**Confidence:** high。

**B4. pi-guard 进入子会话后必然走 headless 分支：默认 `deny`，永不弹框。**
**Sources:** `GUARD/src/policy.ts:46-67`（单行复核：46 = `async function confirmCommand(`，67 = `}`）、`:55` 附近即 `if (!ctx.hasUI)` 分支；`headless` 默认 `"deny"` 见 `GUARD/src/config.ts:9`（**证据文件(未复核)**）；`GUARD/src/index.ts:35-52` 每次事件从 `ctx` 重取 `hasUI`（本轮读取确认大意，行号为证据文件）。**Support:** 直接证据（policy.ts 关键行）+ **证据文件(未复核)**（config/index 行号）。**Confidence:** high。

**B5. pi-subagents 的 `ask` 权限仲裁**不是**"问父会话/问人"：它是一次性 LLM 仲裁者，且官方文档明确"不通知父会话"。**
**Sources:** 文档 `SUB/docs/watchdog.md:181`（单行复核，原文含 "The arbiter returns only `approve` or `deny` and does not notify the parent."）；上游 issue #2010 验收边界 "Permission arbitration currently explicitly forbids asking the parent; do not silently broaden that separate authority-sensitive path."（<https://github.com/nicobailon/pi-subagents/issues/2010>）。**Support:** 直接证据（文档/issue 原文）。**Confidence:** high。

**B6. `permissions` 规则粒度只有工具名，`bash` 被显式拒绝配置、运行时恒 `allow`——命令级策略被明确让渡给 pi-guard。**
**Sources:** `SUB/src/runs/shared/permissions.js:49`（单行复核：`export function permissionDecision(rules, toolName) {`，其体 `if (toolName === "bash" || INTERNAL_TOOLS.has(toolName)) return "allow";`）；同文件 `:22` 附近 `if (tool === "bash") throw new Error(\`${label}.bash is unsupported; pi-subagents leaves bash policy to pi-guard.\`)`；文档 `SUB/docs/watchdog.md:183`（单行复核，含 "Bash is always passed through; bash rules are rejected. Use `pi-guard` for command-level policy."）。**Support:** 直接证据。**Confidence:** high。

**B7. 官方文档把"前台 ask 转发"显式标为 unsupported。**
**Sources:** `SUB/docs/watchdog.md:185`（单行复核，全文末段）："Detached runners receive `PI_SUBAGENT_PARENT_SESSION` from their exact launch and retain it for that dedicated process. **Root and in-process foreground hosts do not publish a global parent identity because multiple Pi sessions can share a host. Environment-only permission extensions therefore cannot safely forward foreground `ask` requests; that path remains unsupported until the extension accepts a session-scoped target.** Native child permissions are unaffected."
**Support:** 直接证据（文档原文）。**Confidence:** high。
**研究者的解读（非原文）：** 这句话有两层含意——(i) 后台 runner 有稳定的父身份（env），(ii) 前台没有全局父身份，因此"仅靠 env 定位父会话的转发"被官方拒绝；官方把可行条件描述为"扩展接受 session-scoped target"。本报告不把它读作"官方承诺未来会做"。

**B8. 后台 runner 进程携带 `PI_SUBAGENT_PARENT_SESSION`。**
**Sources:** `SUB/src/runs/background/async-execution.js:479-482`（单行复核整段：`if (launchParentSessionId === undefined) delete runnerEnv[SUBAGENT_PARENT_SESSION_ENV]; else runnerEnv[…]=launchParentSessionId;`）+ 文档 B7。**Support:** 直接证据。**Confidence:** high。

**B9. 后台 runner 的 stdio 不接任何交互对端（rpc 无消费者）。**
**Sources:** `SUB/src/runs/background/async-execution.js:462-463`（args：binaryHost 时 `["--no-extensions","--no-skills","--no-prompt-templates","--no-session","--mode","rpc","--extension",bootstrap]`）与 `:483-487`（`spawn(command,args,{cwd, stdio:["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore"], env: runnerEnv})`；stdout/stderr 为 `output-*.log` 文件句柄，见 `:450-457`）。**Support:** 直接证据。**Confidence:** high。

**B10. 现有"父 ↔ 后台 runner"控制通道是**文件收件箱**（不是 rpc）。**
**Sources:** `SUB/src/runs/background/control-channel.js:1-15`（注释：parent drops an interrupt request file; the runner watches the inbox）+ `:36-38`（`STEER_REQUESTS_DIR`/`STOP_REQUESTS_DIR`/`REVIVAL_BRIEFS_DIR`）；公开导出只有 `requestAsyncStop`（`SUB/src/api/control-channel.js` 单文件仅一行 re-export）。**Support:** 直接证据。**Confidence:** high。

**B11. 子代理 → 父会话的既有"提问"链路是文件通道 + 父侧轮询，且父侧呈现为消息而非对话框；`progress_update` 不等回复；默认超时 10 分钟。**
**Sources:** `SUB/src/intercom/native-supervisor-channel.js:14`（`DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000`）、`:113`（单行复核：`const expectsReply = params.reason !== "progress_update";`）、`:92-106`（`waitForReply` 轮询 `replies/<id>.json`，deadline 到抛 `Timed out waiting for supervisor reply.`）、`:65-68`（`askTimeoutMs()` 读 `PI_INTERCOM_ASK_TIMEOUT_MS`）；父侧 `poll()` 用 `pi.sendMessage({customType: SUPERVISOR_REQUEST_MESSAGE_TYPE, …},{triggerTurn:true})`（scout 引 `:663-727`，**证据文件(未复核)**）。**Support:** 直接证据（14/113 + 92-106 结构本轮读到）、**证据文件(未复核)**（663-727 原文）。**Confidence:** high（就"是文件通道 + 父侧消息 + 超时"而言）。

**B12. 该 supervisor 链路未公开导出，第三方扩展不可复用；watchdog 的 `permission-arbiter` 同样未公开导出。**
**Sources:** `SUB/package.json:66-135` 全量 `exports` 读取（`.`、`./background-work`、`./external-job-provider`、`./external-runs`、`./agents`、`./inspectors`、`./delegation`、`./capability-ceiling`、`./workflow-resources`、`./required-child-extensions`、`./preflight`、`./control-channel`、`./intercom-bridge`、`./child-tool-plan`、`./shared-types`、`./project-panes`）——**无** `./watchdog`、`./permissions`、`./child-session`、`./native-supervisor-channel`。**Support:** 直接证据。**Confidence:** high。

**B13. `pi.events` 是进程内总线，而且**不达子代理**（文档原文）。**
**Sources:** `SUB/docs/observability.md`（main 分支同文，抓取原文）："`pi.events` is in-process only. It does not reach separate Pi processes or child subagents; use the file lifecycle artifacts or `pi-intercom` for cross-process coordination."；Pi 侧实现 `PI/dist/core/event-bus.js`（`EventEmitter` 包装，无 fs/socket）。**Support:** 直接证据（文档 + 实现）。**Confidence:** high。
**含义（研究者推断）：** 想在同进程内让"父实例 ↔ 子实例"通信，**不要**指望 `pi.events`；`globalThis` 或文件才是可靠载体（本报告 P2 因此选 `globalThis`）。文档措辞未区分"子会话总线是否与父会话是同一实例"，故这条对**同进程跨会话**的适用性属**源码推断**（我未读到 EventBus 的创建点）。

**B14. 存在面向子扩展的"登记回执"信号，但只到 `{id}` 粒度、且是 0.73.1 之后的能力（未确证）。**
**Sources:** `SUB/docs/observability.md`（main）："Cooperating child extensions can acknowledge child-runtime registration by emitting `subagent:acknowledge-extension` on the child session's `pi.events` bus with payload `{ id: string }`. The process that hosts the child session (the parent for foreground children, the runner for background children) captures the acknowledgement in memory."**Support:** 直接证据（文档原文）。**Confidence:** medium（**版本归属未确证**：本轮无法在本机 0.73.1 源码里定位该常量，见第 5 节；且它是"登记回执"而非"请求/应答"）。

### C/D. 可注入性（pi-guard 如何进入子会话）

**D1. `registerRequiredChildExtensions` 是公开 API，按**父会话 id**注册，子会话侧按父会话 id 解析。**
**Sources:** `SUB/src/shared/required-child-extensions.js:56`（单行复核：`export function registerRequiredChildExtensions(input) {`）、`:43-64`（`registry()` 用 `globalThis[Symbol.for("pi-subagents.required-child-extensions.v1")]`，`bySession: Map`）、`:66-70`（`resolveRequiredChildExtensions(sessionId)`）；消费点 `SUB/src/runs/shared/child-launch.js:74`（单行复核：`const requiredExtensions = input.requiredExtensions ?? input.inherited?.requiredExtensions ?? resolveRequiredChildExtensions(input.parentSessionId);`）；`SUB/package.json` 有 `./required-child-extensions` 子路径导出。**Support:** 直接证据。**Confidence:** high。

**D2. 官方文档确认该 API 的用途、生命周期与覆盖范围（含前台/后台/嵌套/恢复），并说明与 `extensions: []`、`denyExtensions` 的关系。**
**Sources:** `SUB/docs/agents.md:378-380`（本轮读取，原文）："Hosts can import `registerRequiredChildExtensions` from `pi-subagents/required-child-extensions` and register `{ sessionId, extensions: [{ id, path }] }`. Paths resolve to existing files and are canonicalized into an immutable launch snapshot … **One registration is allowed per parent session until its idempotent `dispose()` runs, normally on `session_shutdown`.** / Required paths follow ordinary extension resolution and survive agent defaults and `extensions: []` across native foreground, detached, nested, and recovery launches. A `capabilityCeiling.denyExtensions` conflict or required load/provider-registration failure rejects before model resolution. External runners are excluded …"。冲突抛错见 `child-tool-plan.js:175`（单行复核：`if (requiredExtensions.length > 0 && capabilityCeiling?.denyExtensions) {`）；最终追加见 `child-tool-plan.js:293`（单行复核：`const extensionArgs = [...new Set([...ordinaryExtensionArgs, ...requiredExtensions.map(({ path }) => path)])];`）。**Support:** 直接证据（文档 + 关键行）。**Confidence:** high。

**D3. 仍有不依赖 API 的注入侧写法：agent frontmatter `extensions` / `subagentOnlyExtensions`，以及 settings `subagents.defaultExtensions` / `defaultSubagentOnlyExtensions`。**
**Sources:** `SUB/src/agents/agents.js:1084`（单行复核：`function applySubagentDefaultExtensions(agents, defaultExtensions) {`）；其余行号（`:1923-1924`、`:1802-1813`、`:930-945`、`:1102-1113`）为**证据文件(未复核)**；文档 `SUB/docs/watchdog.md:183` 原文亦指向 `extensions` / `subagentOnlyExtensions`。**Support:** 直接证据（1084 + 文档原文）、**证据文件(未复核)**（其余行号）。**Confidence:** high。

**D4. 前台子会话加载扩展的唯一途径是"显式路径"（`noExtensions:true` 只关 ambient/discovered，`additionalExtensionPaths` 照常加载）。**
**Sources:** `child-session.js:230`（D 前置，B3）+ `child-session.js:235`（`additionalExtensionPaths: launch.extensionPaths`，**证据文件(未复核)**）+ `PI/dist/core/resource-loader.js:316-319`（**证据文件(未复核)**，语义：`noExtensions` 时仍合并 `cliEnabledExtensions = additionalExtensionPaths`）。**Support:** 直接证据（B3）+ **证据文件(未复核)**。**Confidence:** medium-high。

**D5. 前台子会话与父会话**同进程但模块实例独立**（`resetExtensionCacheOnReload` 把 `loader.loaded = true`，使子 loader 首次 reload 清缓存）。**
**Sources:** `SUB/src/runs/shared/child-session.js:89-103`（本轮读取，49-99 区间可见该注释与函数；行号为**证据文件**）、`:244-245`（回调告警，**证据文件(未复核)**）。**Support:** 直接证据（注释与函数本轮读到）、行号精度为**证据文件(未复核)**。**Confidence:** high。
**含义（研究者推断）：** 父子两个 pi-guard 实例的**模块级状态不共享**，所以 P2 的桥必须走 `globalThis`/文件这类"进程级"载体——这一点在本机源码注释里被明确点出（"every child in one process would share each extension's module state" 的反面）。

### E. 生态先例（第三方）

**E1. `@gotgenes/pi-permission-system` 实现了"子代理 ask 上抛父 UI + 排队"。**
**Sources:** <https://pi.dev/packages/@gotgenes/pi-permission-system>（原文）："**Forwards prompts from subagents** — `ask` policies work even in non-UI execution contexts, and a forwarded prompt queues behind whatever dialog is already open instead of replacing it"；"**Native `@gotgenes/pi-subagents` integration** — in-process child sessions register with the permission system automatically, enabling per-agent policy enforcement and `ask`-state forwarding to the parent UI without configuration"；"A subagent's ask is reviewed by the chain of the session serving it, one hop up, rather than inside the subagent"。
**Support:** 直接证据（第三方包文档原文）。**Confidence:** medium-high（文档明确；**未读其源码验证实现路径**）。
**注意：** 该包绑定的是**它自己的 subagents 包**（`@gotgenes/pi-subagents`）——不保证与 `nicobailon/pi-subagents@0.73.1` 兼容；其依赖的 seam（第三方文档描述为 `subagents:child:session-created`，在 `bindExtensions()` **之前**同步发出，payload `{sessionId, parentSessionId?}`）在 nicobailon 的包里**未确证存在**（见第 5 节）。

**E2. nicobailon 自己的 `pi-intercom` 提供了跨会话消息与"扩展发件箱"接缝，但答复仍是消息/回合。**
**Sources:** <https://github.com/nicobailon/pi-intercom>（README：本地 broker + `intercom` 工具 + `/intercom` overlay；"Normal sessions only see the regular `intercom` tool"，子代理通过 pi-subagents 的 bridge metadata 得到 `contact_supervisor`）；`extension-api.ts`（仓库克隆副本 `/private/tmp/pi-github-repos/runtime-oCLKzv/…/extension-api.ts` 单文件读取）：`intercom:outbox-request` / `intercom:outbox-result`，`IntercomOutboxResultStatus = "sent"|"rejected"|"blocked"|"failed"`，`IntercomOutboxResultCode` 含 `"confirmation_unavailable"`、`"user_cancelled"`。**Support:** 直接证据（README + 类型文件）。**Confidence:** high（就"存在扩展发件箱接缝与 confirmation_unavailable 语义"而言）；其是否可用于"阻塞式 yes/no 询问"**未确证**。

---

## 3) 候选实现路径对比表

| # | 路径 | 需要改哪个包 | 依赖哪条通道 | 官方支持程度 | 失败模式 | 对无人应答场景的影响 | 可测试性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** | pi-subagents 在 `bindExtensions` 注入 `uiContext`（把父 UI 借给子会话） | **pi-subagents（上游）** | `ExtensionBindings.uiContext`（公开类型，`agent-session.d.ts:143`）；入参只有一个 | 官方**存在该字段**，但"父 UI 转发"**无官方机制/文档**，且 0.73.1 文档把该路径标 unsupported | 子会话 `hasUI` 变 true → 子扩展误判"有 UI"；并行子代理同时弹框（Pi 无对话框排队）；后台 runner 无父 UI 可借（需另建代理）；父侧 `ctx.ui` 归属/取消语义混乱 | 取决于注入实现（可用 `ExtensionUIDialogOptions.timeout` 兜底；不传则永久挂起） | 中：单元可注入假 `uiContext`；端到端要真 TUI 冒烟 |
| **P2（推荐）** | pi-guard 自注入 + 自建"确认上抛"（父侧 broker + 子侧 client） | **只改 pi-guard**（可选：为 backend 用 `PI_SUBAGENT_PARENT_SESSION`） | 注入：`pi-subagents/required-child-extensions`（或 frontmatter `extensions`/settings `defaultExtensions`）；上抛：前台=同进程 `globalThis` broker，后台=临时目录文件队列 | 注入=**官方公开 API + 官方文档**；上抛=**需自行发明**（生态有 P/E1 先例，无官方规范） | 父侧未加载 pi-guard / 父无 UI → 与现状一致地 fail-closed `deny`；父侧版本旧 → 协议版本不匹配（需 `version` 字段 + 忽略未知字段）；多父会话歧义（用 `parentSessionId` 定向 + 目录 `0700`）；请求残留/清理；自建并发队列否则对话框互相顶掉；子侧超时策略必须显式 | **可设计为明确**：子侧 deadline 到期 → `deny`（保持 fail-closed），父侧无人点按同理；不会无限挂起（前提是设置 timeout） | 高：协议层纯函数可单测；broker 可注入假 UI；子侧可注入假 client；端到端需真 TUI |
| **P3** | 复用 watchdog `ask` 权限仲裁 | pi-subagents（上游）+ agent frontmatter 规则 | `registerPermissionGate` → `requestWatchdogPermission`（一次性 LLM arbiter） | 官方功能**存在且成文**，但**明确"不通知父会话"**（issue #2010：explicitly forbids asking the parent） | 不是弹框；`permissions` 只有工具名粒度；`bash` 恒 `allow`（B6）→ **对 bash 危险命令完全无效** | fail-closed `deny`（源码/文档证实） | 中 |
| **P4** | intercom / `contact_supervisor` 阻塞式询问 | 依赖 pi-subagents（bridge active）+ 可选 pi-intercom；pi-guard 需自建等价的"请求文件 + 轮询" | `TEMP_ROOT_DIR/supervisor-channels/<runId>-<agent>-<idx>/{requests,replies}`；父侧 `pi.sendMessage` + `triggerTurn` | 官方（pi-subagents）**文档+源码证实存在**，但**不作为扩展 API 导出**（B12）；父侧呈现不是 `ctx.ui.confirm` | intercom bridge `off`/`fork-only`/无可定位父会话 → 通道不注册；父侧无轮询者 → 阻塞；`progress_update` 不等回复；答复是模型回合，不是人点按钮的布尔值 | 子侧抛 `Timed out waiting for supervisor reply.`（默认 10 min，`PI_INTERCOM_ASK_TIMEOUT_MS`）→ 表现为子代理工具调用失败，**不是** deny | 中：文件协议可测；父侧需模型回合 |
| **P5** | 仅外部通知（兜底/最小改动） | 只改 pi-guard | OS 通知 / 写 artifact / `pi.exec` 外部命令（pi-guard 已有 `notify.ts` 通知层，但 `notifyConfirm` 仅在 `mode === "tui"` 时发） | 无专门机制 | 人可能没看到；无回执；不阻塞 | 保持 `deny`（不挂起，行为与现状一致） | 高（易测） |
| **P6** | 配置级缓解：子会话 `DCG_PI_HEADLESS=allow` | 无代码改动 | 无 | 官方支持（pi-guard 既有配置） | **语义变化**：子代理危险命令直接放行，只剩通知/审计 | 不再阻塞（也就没有"确认"） | 高 |

### P2 的落地草图（本报告推荐的最小可行设计）

- **父侧（`ctx.hasUI === true` 的实例）**
  - `session_start` 时注册进程内 broker：`globalThis[Symbol.for("pi-guard.confirm-bridge.v1")].register(parentSessionKey, handler)`；
  - 后台：在自己独占的队列目录（如 `$TMPDIR/pi-guard-confirm/<parentSessionId>/{requests,replies}`，`0700`）上做 250ms 轮询 + `fs.watch`；
  - `handler(request) → ctx.ui.confirm(title, message, { timeout })`（`ExtensionUIDialogOptions` 支持 `signal`/`timeout`），并把结果写回；**自建队列**避免与自身对话框互相顶掉。
- **子侧（`ctx.hasUI === false` 的实例）**
  - 先查进程内 broker（**前台**，同进程必命中）；
  - 未命中则按 `process.env.PI_SUBAGENT_PARENT_SESSION` 定向写请求文件并轮询 `replies/`（**后台**；该变量由 `async-execution.js:479-482` 写入 runnerEnvisist）；取不到父 id 时可选"广播队列"降级（多父会话有误答风险，需显式开关）；
  - deadline（默认与 pi-guard 的 headless 语义一致）到期 → `deny`。
- **协议**：`{ version: 1, kind: "command"|"stdin", requestId, parentSessionId?, childSessionId, agent?, toolName, commandPreview(截断+脱敏复用 `summarizeCommand`), reason, rule?, createdAt, expiresAt? }` → `{ version: 1, requestId, confirmed: boolean, decidedBy: "user"|"timeout"|"unavailable", message? }`。
- **注入**：父侧实例在 `session_start` 调 `registerRequiredChildExtensions({ sessionId: <父会话 id>, extensions: [{ id: "pi-guard", path: <本包入口真实路径> }] })`，`session_shutdown` `dispose()`；`import("pi-subagents/required-child-extensions")` 必须 `try/catch`（未装 pi-subagents 时静默跳过）。**注意 D2 的"每个父会话只允许一次注册"**：若已有其它宿主注册，会抛 `Required child extensions are already registered for session …`，需要捕获并退化到 frontmatter/settings 方案（D3）。

---

## 4) 证据文件复核结果

**方法**：对关键 `file:line` 用 `read(offset=N, limit=1)` **单行定位**（多行读取会因空行渲染导致行号漂移，本轮已踩过一次，故全部改用单行复核）。

| # | 证据文件声称 | 我的单行复核结果 | 判定 |
| --- | --- | --- | --- |
| 1 | `SUB/src/runs/shared/child-session.js:291-298` `bindExtensions({ mode:"print", ... })`，不传 `uiContext` | `:292` = `mode: "print",`（块起始为 291 的 `await session.bindExtensions({`，同块内 `onError` 紧随） | **一致** |
| 2 | `PI/dist/core/extensions/runner.js:363-365` `hasUI()` = `uiContext !== noOpUIContext` | `:364` = `return this.uiContext !== noOpUIContext;` | **一致** |
| 3 | `GUARD/src/policy.ts:46-67` `confirmCommand`（含 `!ctx.hasUI` 分支） | `:46` = `async function confirmCommand(`，`:67` = `}`，`:55` 落在 `!ctx.hasUI` 分支体内 | **一致** |
| 4 | `SUB/src/runs/shared/permissions.js:49-53` `permissionDecision`（bash 恒 allow）；`:12-30` `validatePermissionRules`（bash 拒绝） | `:49` = `export function permissionDecision(rules, toolName) {`；`:22` = bash 拒绝的 `throw`；函数范围与 12-30 吻合 | **一致** |
| 5 | `SUB/src/runs/shared/child-launch.js:187` `ambientExtensions = input.host === "runner" && …` | `:187` = 完全同文 | **一致** |
| 6 | `SUB/src/runs/shared/child-session.js:230` `noExtensions: !launch.ambientExtensions` | `:230` = 完全同文 | **一致** |
| 7 | `SUB/docs/watchdog.md:181`（ask 仲裁不通知父会话）、`:183`（pi-guard/ambient 段落） | 单行复核：`:181` = ask 段落、`:183` = bash/pi-guard 段落、`:185` = `PI_SUBAGENT_PARENT_SESSION` 段落 | **一致**（且 `:185` 是本轮新增的关键证据） |
| 8 | `SUB/src/runs/shared/child-tool-plan.js:175-177`（requiredExtensions × denyExtensions 抛错）、`:293`（required 追加到末尾） | `:175` = `if (requiredExtensions.length > 0 && capabilityCeiling?.denyExtensions) {`；`:293` = `const extensionArgs = [...new Set([...ordinaryExtensionArgs, ...requiredExtensions.map(({ path }) => path)])];` | **一致** |
| 9 | `SUB/src/shared/required-child-extensions.js:56-68`；`child-launch.js:74` 消费 | `:56` = `export function registerRequiredChildExtensions(input) {`；`child-launch.js:74` = `resolveRequiredChildExtensions(input.parentSessionId)`（**注意：注册键是父会话 id**，比证据文件的措辞更精确） | **一致**（并在语义上补强） |
| 10 | `SUB/src/intercom/native-supervisor-channel.js:14/113/92-106/65-68` | `:14` = `DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000;`；`:113` = `const expectsReply = params.reason !== "progress_update";`；`waitForReply`/`askTimeoutMs` 结构与 92-106 / 65-68 吻合 | **一致** |
| 11 | `SUB/src/agents/agents.js:1084-1096` `applySubagentDefaultExtensions` | `:1084` = `function applySubagentDefaultExtensions(agents, defaultExtensions) {` | **一致** |
| 12 | `PI/dist/core/extensions/types.d.ts:209` `ExtensionMode`；`:210-248` `ExtensionContext` | 单行复核 `:209` = `export type ExtensionMode = "tui" \| "rpc" \| "json" \| "print";`；上下文接口字段（ui/mode/hasUI/cwd/sessionManager…）与证据一致 | **一致** |

**结论：本轮复核的 12 条（远超要求的 5 条）全部与证据文件一致，未发现"证据文件称 X，实际 Y"的偏差。**
两点必须披露的差异（非事实性冲突，属精度/口径）：
1. **两份证据文件对同一段 Pi 代码给出不同行号**：`evidence-pi-child-session-ui-api.md` 说 `runner.js:313-330` 是 `wrapUIPromptContext`，`evidence-pi-subagents-child-guard-seams.md` 说 `:318-333`。本轮读取显示 `wrapUIPromptContext` 实现与 `withUIPrompt` 相邻（约 318-329 / 330-352），两文件应是行区间口径不同；**我未能用单行法逐个钉死**，故不判定谁对谁错。
2. **两份证据文件使用不同的 Pi dist 路径**（一份 `…/cairnkv/.pi/npm/…`，一份 `…/mise/installs/…`），版本均为 0.87.1。本轮统一使用 mise 路径（实测可读、`package.json:3` = 0.87.1）。→ 若你实际运行的是另一个副本，行号可能有位移（语义应一致）。

**未复核的证据文件条目（本轮未逐条重读）**：`permission-arbiter.js` 全链路、`native-supervisor-channel.js:663-727` 父侧 poll 原文、`intercom-bridge.js:174-177`、`resource-loader.js:316-319`、`child-session.js:89-103 / 235 / 244-245` 精确行号、`agents.js:1802-1813/1923-1924/930-945/1102-1113`、`config.ts:9/170`、`index.ts:35-52`、scout 对 Pi `examples/` 与 `docs/` 的行号断言。这些在报告中均已标为「**证据文件(未复核)**」。

---

## 5) 未确证项与检索位置清单

| # | 未确证项 | 本轮检索/尝试位置 | 缺口性质 |
| --- | --- | --- | --- |
| 5.1 | `dcg 0.14.0` 与 `pi --version` 未复核 | 本轮无 bash 工具，无法执行 `dcg --version` / `pi --version` | 仅"未复核"，与结论无关（dcg 只影响判定内容，不影响通道可行性） |
| 5.2 | **Pi 侧"不存在上抛机制"依赖 scout 的穷尽 grep** | 我复核的范围：pi.dev/docs/latest/extensions 全文关键词（`escalat` 零命中）；CHANGELOG（`child session`/`bindExtensions` 零命中）；npm `dist-tags.latest=0.87.1`；`types.d.ts:209-248` 公开面；`runner.js:364`。**未重跑** scout 记录的关键词穷尽命令 | **未确证**：可能漏检"命名完全不同"的机制（概率低，因为任何扩展可调的新 API 必须出现在 `dist/**/*.d.ts` 导出面） |
| 5.3 | **nicobailon/pi-subagents 是否发出 `subagents:child:session-created`（bindExtensions 之前的子会话公告）** | 检索位置：`SUB/package.json` exports 全表；main 分支 `docs/extension-api.md`、`docs/observability.md`、`docs/configuration.md` 抓取后关键词 `session-created`/`registerRequiredChildExtensions`（**均零命中**）；本机源码未做 grep（无工具）；该 seam 只见于第三方 `un-bien` 文档对 `@gotgenes` 实现的描述 | **未确证（偏"不存在于 nicobailon 包"）**：这直接决定"能否复刻 gotgenes 那套无需配置的自动注册" |
| 5.4 | `subagent:acknowledge-extension` 是否属于 0.73.1 | 只见于 main 分支 `docs/observability.md`；本机 0.73.1 未定位到该常量（无 grep 工具） | **未确证版本归属**；即使存在，也只是"登记回执"，不承载请求/应答 |
| 5.5 | 后台 runner 进程内 child session 的 `process.env` 是否保留 `PI_SUBAGENT_PARENT_SESSION` | 已核：`async-execution.js:479-482` 把该变量写进 **runner 进程 env**；`child-session.js:243` 会 `applyProcessEnv(launch.processEnv)`，但我未展开 `applyProcessEnv` 定义（应位于 `child-session.js:100-150` 区间）确认它是"叠加"还是"重置" | **未确证**（低风险：同进程继承，除非被显式删除）。设计上建议不依赖它做强假设（P2 草图中保留"广播队列"降级） |
| 5.6 | `pi.events` 对**同进程不同会话**是否可用 | 已核文档一句"in-process only … does not reach … child subagents"；未核 `createEventBus()` 的创建点（每 session 一个 vs 每进程一个） | **未确证**；P2 因此**不依赖** `pi.events`，改用 `globalThis` |
| 5.7 | `@gotgenes/pi-permission-system` 的实际实现方式（是否真用 `globalThis`/文件、是否排队、超时策略） | 只读了 pi.dev 包页文字与 `@gotgenes/pi-subagents` 的第三方向接缝描述（`un-bien` 文档）；**未读其源码** | **未确证**：作为"先例存在"是文档证实，作为"可照抄的方案"未验证 |
| 5.8 | P2 的端到端行为（父侧对话框在子会话阻塞期间能否正常渲染、并发对话框如何排队、后台跨进程延迟） | 本轮**只读**，未做任何 PoC/实测 | **未确证**：属实现阶段必须实测的风险点 |
| 5.9 | 前台子代理 pi-guard 取 `.pi/guard.json` 的 cwd 语义（`process.cwd()` = 父进程 cwd，而非子会话 cwd） | 证据文件 5.2 已记录；本轮读了 `GUARD/src/config.ts` 的 `loadGuardConfig` 语义未逐行复核 | **证据文件(未复核)**；对"弹框"目标无影响，但会影响"用哪份策略确认" |

---

## 6) 参考

### 保留（本轮直接读过/抓过的源）

**官方文档（在线）**
- Pi 官方扩展文档 <https://pi.dev/docs/latest/extensions> — 官方对"各模式下的 UI 能力"与"非交互模式怎么办"的唯一指引；含"JSON and print modes have no UI"原文
- pi-subagents 官方文档 `docs/watchdog.md`（本机 0.73.1 + main 分支同文）— 三处决定性原文：ask 仲裁不通知父会话、bash 交给 pi-guard、**前台 ask 转发 unsupported**
- pi-subagents 官方文档 `docs/observability.md`（main）— `pi.events` 不跨进程/不达子代理；`subagent:child-status`；`subagent:acknowledge-extension`（版本归属未确证）
- pi-subagents 官方文档 `docs/agents.md:378-380`（本机 0.73.1）— `registerRequiredChildExtensions` 的用途、生命周期、"每父会话一次注册"、跨 host kind 覆盖范围
- pi-subagents issue #2010 <https://github.com/nicobailon/pi-subagents/issues/2010> — 上游对"permission arbitration 不得问父会话"的明文边界（权威的"官方不做"证据）
- `@earendil-works/pi-coding-agent` CHANGELOG（GitHub main raw）— 确认到 0.87.1 无子会话 UI 上抛特性
- npm registry 元数据 — `dist-tags.latest = 0.87.1`

**本机源码（本轮 `read` 复核，最高优先级）**
- `SUB/src/runs/shared/child-session.js`（`:230`、`:291-292`、`:89-103` 注释）— 子会话 UI/扩展加载真相
- `SUB/src/runs/shared/child-launch.js`（`:74`、`:187`）
- `SUB/src/runs/shared/child-tool-plan.js`（`:175`、`:293`）
- `SUB/src/runs/shared/permissions.js`（`:22`、`:49`）
- `SUB/src/shared/required-child-extensions.js`（`:43-70`）
- `SUB/src/intercom/native-supervisor-channel.js`（`:14`、`:113`、`:92-106`）
- `SUB/src/agents/agents.js:1084`
- `SUB/src/runs/background/async-execution.js`（`:462-463`、`:479-482`、`:483-487`）
- `SUB/src/runs/background/control-channel.js:1-38`、`SUB/src/api/control-channel.js`
- `SUB/package.json`（exports 全表）、`SUB/docs/*.md`
- `GUARD/src/policy.ts:46-67`、`GUARD/src/index.ts`、`plugins/pi-guard/package.json`
- `PI/dist/core/extensions/runner.js:364`、`PI/dist/core/extensions/types.d.ts:209-248`、`PI/dist/core/event-bus.js`

**生态（第三方，明确标注非官方）**
- `@gotgenes/pi-permission-system` 包页 <https://pi.dev/packages/@gotgenes/pi-permission-system> — "子代理 ask 上抛父 UI + 排队"的既有实现（先例）
- `nicobailon/pi-intercom` <https://github.com/nicobailon/pi-intercom> + `extension-api.ts`（克隆副本）— 跨会话消息 / 扩展发件箱接缝（`confirmation_unavailable` 等）
- `un-bien` 文档 <https://docs.georgeharker.com/un-bien/main/docs/subagent-events.html> — 描述 `@gotgenes` 生态的"子会话公告 seam"与 `PI_SUBAGENT_PARENT_SESSION` 约定（**第三方/派生生态文档，只作先例参考**）

**本仓库既有取证**
- `docs/research/evidence-pi-subagents-child-guard-seams.md`
- `docs/research/evidence-pi-child-session-ui-api.md`

### 拒绝/降级
- Tavily 生成的摘要性回答（"`PI_SUBAGENT_PARENT_SESSION` … is used by the permission system to forward `ask` prompts from subagent processes back to the parent session's UI for confirmation"）— **与 pi-subagents 官方文档直接冲突**（watchdog.md:181/185），且把 gotgenes 生态的能力说成 nicobailon 包的能力；**未采信**，仅作为"存在争议来源"记录
- `coinmarketcap` / `cryptorank` 等关键词误召回（"Pi" 加密货币）— 无关
- `pi.dev/packages/@mickyyy68/pi-subagents`、`@johnnywu/pi-subagents`、`@mjakl/pi-subagent`、`tintinweb/pi-subagents` 等同类包页面 — 非本任务基线包，仅用于确认"多实现并存、seam 各不相同"，未采信其具体行为描述

### 记录在案的分歧
- **Tavily 摘要 vs pi-subagents 官方文档**：前者称权限系统会把子代理 `ask` 转发到父会话 UI，后者（0.73.1 + main）明文写"arbiter … does not notify the parent"且"forwarding foreground `ask` requests … remains unsupported"。**以官方文档为准**；Tavily 的描述更可能对应 `@gotgenes/pi-permission-system` 或第三方 fork。
- **两份 scout 证据文件**：对 Pi `runner.js` 的 `wrapUIPromptContext` 行区间不一致（313-330 vs 318-333）；对 Bash/ask 段落以外的文档行号一致。**未发现影响结论的冲突。**

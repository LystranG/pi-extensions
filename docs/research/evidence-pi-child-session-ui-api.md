# 证据：无界面子会话能否把 UI 确认请求交给父会话/宿主（本机 Pi 0.87.1）

调研范围：**只读**取证。最高优先级证据 = 本机已发布的 Pi 0.87.1 npm 包（`dist/` 的 `.d.ts` 与未压缩 `.js`、包内 `docs/`、`examples/`）。

- `$PI` = `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-coding-agent`
- 结论标签：**【已证实】**= 本机包内直接读到代码/声明/文档；**【已证实不存在】**= 在完整包内穷尽检索为零命中且能解释为什么不存在；**【未确证】**= 我没能取到该证据（含工具受限）。

---

## 1) 基线版本

| 项 | 值 | 证据 |
|---|---|---|
| Pi coding agent 版本 | `0.87.1` | `node -p "require('$PI/package.json').version"` → `0.87.1` |
| 包名 | `@earendil-works/pi-coding-agent` | `$PI/package.json` |
| 形态 | 已发布的 `dist/`（`.js` + `.d.ts` + `.js.map`），随包附带 `docs/`(39 项) + `examples/` | `ls $PI` |
| 本机 docs 是否被裁剪 | **未裁剪**，`docs/` 含 `extensions.md`、`rpc.md`、`rpc-extension-ui.md`、`rpc-commands.md`、`json.md`、`sdk.md`、`cli-integration.md` 等 39 项 | `find $PI/docs -type f` |

> 注：`AGENTS.md` 禁止在插件中引用 `dist/` 或内部源码；本报告读 `dist/` 仅用于**取证**（`dist/*.d.ts` 正是公开导出面），不是要照抄内部路径。

---

## 2) 逐条事实

### Q1 `ExtensionContext.ui` 的类型、mode 取值、`hasUI` 判定、print/rpc 下 `confirm` 行为

**a. 类型与 mode 取值** 【已证实】

`$PI/dist/core/extensions/types.d.ts:209`
```ts
export type ExtensionMode = "tui" | "rpc" | "json" | "print";
export interface ExtensionContext {
    /** UI methods for user interaction */
    ui: ExtensionUIContext;
    /** Current run mode. Use "tui" to guard terminal-only UI such as custom components. */
    mode: ExtensionMode;
    /** Whether dialog-capable UI is available (true in TUI and RPC modes) */
    hasUI: boolean;
```

`ui: ExtensionUIContext` 是**每个 mode 各自注入的一个实现对象**（不是 class），接口全文见 `types.d.ts:63-193`（`select/confirm/input/notify/onTerminalInput/setStatus/setWorkingMessage/setWidget/setFooter/setHeader/setTitle/custom/pasteToEditor/setEditorText/getEditorText/editor/addAutocompleteProvider/setEditorComponent/getEditorComponent/theme/getAllThemes/getTheme/setTheme/getToolsExpanded/setToolsExpanded`）。`ExtensionUIContext` 是公开导出（`$PI/dist/index.d.ts:8`）。

`confirm` 签名（`types.d.ts:72-73`）：
```ts
/** Show a confirmation dialog. */
confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
```
`ExtensionUIDialogOptions = { signal?: AbortSignal; timeout?: number }`（`types.d.ts:43-50`）。

**b. `hasUI` 的判定条件** 【已证实】

**唯一判定 = "当前注入的 uiContext 是否就是内置的 no-op 实现"**：

`$PI/dist/core/extensions/runner.js:363`
```js
hasUI() {
    return this.uiContext !== noOpUIContext;
}
```
- `noOpUIContext` 定义：`runner.js:132-160`（`confirm: async () => false` 在 `:134`，`select/input -> undefined`，`notify -> () => {}`，`setTheme -> {success:false,error:"UI not available"}`）
- `ExtensionRunner` 构造时默认 `this.uiContext = noOpUIContext`：`runner.js:196-202`
- `setUIContext(uiContext, mode = "print")`：`runner.js:315`
  ```js
  setUIContext(uiContext, mode = "print") {
      this.uiContext = uiContext ? this.wrapUIPromptContext(uiContext) : noOpUIContext;
      this.mode = mode;
  }
  ```
  → 传入 falsy 就是 no-op；**mode 与 hasUI 互相独立**（mode 缺省是 `"print"`，会被显式覆盖）。
- `ctx` 的 `ui/mode/hasUI` 都是 getter，在每次读取时解析：`runner.js:549-570`
- 各 mode 的实际注入：
  - interactive/TUI：`$PI/dist/modes/interactive/interactive-mode.js:1434` `bindExtensions({ uiContext, mode: "tui", ... })` → `hasUI = true`
  - RPC：`$PI/dist/modes/rpc/rpc-mode.js:230` `bindExtensions({ uiContext: createExtensionUIContext(), mode: "rpc", ... })` → `hasUI = true`
  - print / json：`$PI/dist/modes/print-mode.js:53` `bindExtensions({ mode: mode === "json" ? "json" : "print", commandContextActions: {...} })` → **完全不传 `uiContext`** → 保持 `noOpUIContext` → `hasUI = false`
  - 官方文档同结论：`$PI/docs/extensions.md:189-192`
    > `RPC can forward supported dialogs and notifications ... but not custom terminal components; JSON and print modes have no UI.`
    > `Guard terminal-only behavior with ctx.mode === "tui" and use ctx.hasUI for interactions supported by interactive and RPC clients.`
  - RPC 的 `hasUI=true` 反直觉点由官方文档明说：`$PI/docs/rpc-extension-ui.md:25`
    > `ctx.mode is "rpc" and ctx.hasUI is true in RPC mode ... Use ctx.mode === "tui" to guard TUI-specific features`

**c. `ctx.ui.confirm` 在 print 模式的行为** 【已证实】

`noOpUIContext.confirm = async () => false`（`runner.js:134`）
→ 立即 resolve，**返回 `false`（= 自动否定）**，不抛错、不阻塞、不打印、不产生任何输出。同理 `select/input/editor -> undefined`，`notify` 静默丢弃。json 模式与 print 模式共用同一 no-op。

**d. `ctx.ui.confirm` 在 rpc 模式的行为** 【已证实】

`$PI/dist/modes/rpc/rpc-mode.js:80`
```js
confirm: (title, message, opts) => createDialogPromise(
    opts, false, { method: "confirm", title, message, timeout: opts?.timeout },
    (r) => "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
```
`createDialogPromise`（`rpc-mode.js:48-79`）行为：
1. `opts.signal` 已 abort → 立即 resolve 默认值（confirm 为 `false`）
2. `opts.signal` abort 事件 → resolve `false`
3. 显式传 `opts.timeout` → 到点 resolve `false`（**不传 timeout 就一直阻塞等待客户端响应**）
4. 否则 `output({ type: "extension_ui_request", id, method:"confirm", title, message, timeout })` 写到 stdout，阻塞直到 stdin 收到同 `id` 的 `extension_ui_response`
5. 响应解析：`{cancelled:true} -> false`；`{confirmed:boolean} -> 该值`；未识别形状 → `false`
→ **不抛错**；只有显式 timeout/signal 才会"自动否定"，否则无限等待。文档同结论：`$PI/docs/rpc-extension-ui.md:7,10,25`。

**e. 附带发现：`ctx.ui` 的每次调用都会发 `ui_prompt_start`/`ui_prompt_end` 事件** 【已证实】

`runner.js:313-330`（`wrapUIPromptContext`）把 `select/confirm/input/editor/custom` 全部包进 `withUIPrompt(kind, title, run)`；`runner.js:331-352` 用 `queueMicrotask` 异步 emit `{type:"ui_prompt_start", reason:"ui_prompt", kind, title?}` / `ui_prompt_end`。类型：`types.d.ts:629-641`；已公开导出（`dist/index.d.ts:8` 含 `UIPromptStartEvent/UIPromptEndEvent/UIPromptKind`）；注册入口 `types.d.ts:1002-1003`。
→ 是**只读观测信号，没有返回值/无法代替回答**；而且只作用于**同一进程同一 session 的扩展**。

---

### Q2 `session.bindExtensions` 签名与选项 / `createAgentSession` / `DefaultResourceLoader`

**a. `ExtensionBindings` 允许注入自定义 UI 实现和 mode** 【已证实】

`$PI/dist/core/agent-session.d.ts:143`
```ts
export interface ExtensionBindings {
    uiContext?: ExtensionUIContext;
    mode?: ExtensionMode;
    commandContextActions?: ExtensionCommandContextActions;
    abortHandler?: () => void;
    shutdownHandler?: ShutdownHandler;
    onError?: ExtensionErrorListener;
}
```
`$PI/dist/core/agent-session.d.ts:597` `bindExtensions(bindings: ExtensionBindings): Promise<void>;`
实现：`$PI/dist/core/agent-session.js:2293-2312`（逐字段可选覆盖 `_extensionUIContext` / `_extensionMode` …，然后 `_applyExtensionBindings(this._extensionRunner)` → `runner.setUIContext(this._extensionUIContext, this._extensionMode)`，见 `agent-session.js:2355`）——即**宿主（SDK/模式层）可以注入任意 `ExtensionUIContext` 实现**，例如一个把对话框转发给父进程/父会话的代理实现。这是唯一官方的"扩展 UI 由谁实现"注入点。

**b. `createAgentSession` 是否接受 UI 相关选项** 【已证实：不接受】

`$PI/dist/core/sdk.d.ts:10-56`（`CreateAgentSessionOptions`）字段：`cwd / agentDir / modelRuntime / model / thinkingLevel / scopedModels / noTools / tools / excludeTools / customTools / resourceLoader / sessionManager / settingsManager / sessionStartEvent`。
→ **没有 `ui` / `uiContext` / `mode` / `hasUI` 任何一项**。
`$PI/dist/core/sdk.d.ts:61-62` 反而提示宿主自己绑：
```ts
/** Extensions result (for UI context setup in interactive mode) */
extensionsResult: LoadExtensionsResult;
```
`$PI/docs/sdk.md` 通篇无 UI/mode 选项，只列 `modelRuntime / model / thinkingLevel / scopedModels / settingsManager / sessionManager / resourceLoader / tools...`。
→ 用 SDK 建会话的宿主，**必须自己调用 `session.bindExtensions({ uiContext, mode })`**，否则扩展看到的 `ui` 就是 no-op、`hasUI=false`。

**c. 扩展自身能否改 bindings / 拿到 session** 【已证实：不能】

`ExtensionContext`（`types.d.ts:210-248`）只有 `ui/mode/hasUI/cwd/sessionManager/modelRegistry/model/...`；`ExtensionAPI`（`types.d.ts:978-1159`）只有 `on/registerTool/registerCommand/registerShortcut/registerFlag/sendMessage/sendUserMessage/appendEntry/setSessionName/setLabel/exec/registerProvider/events` 等。**没有任何暴露 `bindExtensions`、`setUIContext`、`session` 或宿主通信句柄的成员。**
→ 对"扩展自己被父扩展要求接管 UI"这件事，**扩展侧没有官方自助通道**（详见 Q4）。

**d. `DefaultResourceLoader` 与 UI 的关系** 【已证实：无关】

`dist/index.d.ts:18` 导出 `DefaultResourceLoader, loadProjectContextFiles`；`dist/core/resource-loader.d.ts` 只有一项与 UI 沾边的 import（`import type { Theme }`，用于主题加载）。`docs/sdk.md:112` 说明 `DefaultResourceLoader` 只用来注入 inline extension（`InlineExtension = ExtensionFactory | {name, factory, hidden?}`，`types.d.ts:1241-1247`）。
→ `DefaultResourceLoader` **不能**设置 uiContext / mode；加载扩展与绑定 UI 是两件事。

---

### Q3 RPC 模式：`pi --mode rpc` 是否把扩展 UI 请求通过 JSON-RPC 发给宿主

**结论：是（JSONL，非 JSON-RPC），有完整协议与官方文档。** 【已证实】

协议形状（`$PI/dist/modes/rpc/rpc-types.d.ts:393-475`，公开导出见 `dist/index.d.ts:28` 的 `RpcExtensionUIRequest` / `RpcExtensionUIResponse`）：

请求（Pi → 宿主 stdout，9 种 `method`）：
```ts
export type RpcExtensionUIRequest =
  | { type:"extension_ui_request"; id:string; method:"select"; title:string; options:string[]; timeout?:number }
  | { type:"extension_ui_request"; id:string; method:"confirm"; title:string; message:string; timeout?:number }
  | { type:"extension_ui_request"; id:string; method:"input"; title:string; placeholder?:string; timeout?:number }
  | { type:"extension_ui_request"; id:string; method:"editor"; title:string; prefill?:string }
  | { type:"extension_ui_request"; id:string; method:"notify"; message:string; notifyType?:"info"|"warning"|"error" }
  | { type:"extension_ui_request"; id:string; method:"setStatus"; statusKey:string; statusText:string|undefined }
  | { type:"extension_ui_request"; id:string; method:"setWidget"; widgetKey:string; widgetLines:string[]|undefined; widgetPlacement?:"aboveEditor"|"belowEditor" }
  | { type:"extension_ui_request"; id:string; method:"setTitle"; title:string }
  | { type:"extension_ui_request"; id:string; method:"set_editor_text"; text:string };
```
响应（宿主 → Pi stdin，仅 4 种 dialog 需要）：
```ts
export type RpcExtensionUIResponse =
  | { type:"extension_ui_response"; id:string; value:string }        // select/input/editor
  | { type:"extension_ui_response"; id:string; confirmed:boolean }   // confirm
  | { type:"extension_ui_response"; id:string; cancelled:true };
```
分类：`select/confirm/input/editor` = **请求-响应（阻塞）**；`notify/setStatus/setWidget/setTitle/set_editor_text` = **fire-and-forget**。实现位置：`$PI/dist/modes/rpc/rpc-mode.js:74-84`（dialog，含 `createDialogPromise` 于 `:48-79`）与 `:85-200`（fire-and-forget，`crypto.randomUUID()` 生成 id）；装配点 `rpc-mode.js:230-232`。
文档出处：`$PI/docs/rpc-extension-ui.md`（全文；`:7` dialog 阻塞语义、`:10` timeout 自动 resolve、`:12-23` limitations、`:25` mode/hasUI 说明、`Requests from Pi` / `Responses to Pi` 两节的逐字段 JSON 示例）；`$PI/docs/rpc.md:33`（四类记录表："Both | Extension UI record"）、`docs/rpc.md:68`；`$PI/docs/cli-integration.md:68,70`。

**宿主如何响应（实现证据）**：`$PI/examples/rpc-extension-ui.ts`
- `:52` 定义 `ExtensionUIRequest`
- `:540` 主循环 `if (data.type === "extension_ui_request")`
- `:402-405` confirm 分支 → `send({ type:"extension_ui_response", id, confirmed: value === "Yes" })`
- `:394,414,426` select/input/editor → `{value}` 或 `{cancelled:true}`
- `$PI/examples/extensions/rpc-demo.ts` 是被驱动的示例扩展（`ctx.hasUI` 守卫见 `:53,72`）

**宿主侧库的缺口（重要）** 【已证实】
导出的 `RpcClient`（`dist/index.d.ts:28`）**没有**任何扩展 UI API：`dist/modes/rpc/rpc-client.d.ts` 内 `grep -i "ui"` **零命中**，方法表只有 `prompt/steer/abort/getState/bash/compact/...`。
`rpc-client.js:409-424 handleLine()` 只用 `type === "response" && id` 匹配 pending 请求，**其余所有记录原样丢给 `eventListeners`**（含 `extension_ui_request`，但该 listener 的静态类型是 `JsonAgentSessionEvent`，需要自行 narrow/cast）；而且**没有公开的"发送 `extension_ui_response`"方法**（只有私有 `send()`）。
→ 想用 RpcClient 建"父进程 UI 代理"，得自己扩 `RpcClient`（或直接用 `spawn` + 自写 JSONL 循环，像示例那样）。

---

### Q4 有没有官方「无界面会话把确认请求上抛」的机制/降级约定

**结论：没有通用机制。官方只有"能力探测 + 扩展自己降级"的约定。** 【已证实】

- 关键词穷尽检索（`$PI/dist` + `$PI/docs` + `$PI/examples`，排除 `*.map`）：`escalate` = 0，`requestApproval` = 0，`delegateApproval` = 0，`forwardApproval` = 0，`proxyUI` = 0，`ask host` = 0。见第 5 节命令。
- **官方既定做法**（`$PI/docs/extensions.md:189-193`）：扩展加载在四种模式下都跑；非交互下要么用 `ctx.hasUI` 跳过，要么只能靠 RPC 协议；`Keep tool and event behavior independent from rendering so non-interactive modes remain functional.` 没有"向上求助"的钩子。
- **仓库内所有官方示例都写成"两个分支"，而不是"上抛"**：
  - `examples/extensions/confirm-destructive.ts:12,47` `if (!ctx.hasUI) return;`（提前放行/兜底）
  - `examples/extensions/permission-gate.ts:20` `if (!ctx.hasUI) { … }`（无 UI 时用非交互策略，如 deny）
  - `examples/extensions/dirty-repo-guard.ts:28`、`project-trust.ts:29`、`widget-placement.ts:5` 同构
  - `examples/extensions/rpc-demo.ts:53,72` `if (!ctx.hasUI) return;`
- **唯一"宿主代答"的官方设计**是 **`project_trust` 事件**：`types.d.ts:392-403`
  ```ts
  export interface ProjectTrustContext {
      cwd: string;
      mode: ExtensionMode;
      hasUI: boolean;
      ui: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify">;
  }
  export type ProjectTrustHandler = (event, ctx) => Promise<ProjectTrustEventResult> | ProjectTrustEventResult;
  ```
  即 Pi 允许扩展**代表宿主**回答"项目是否可信"——但这是**专门为 project trust 一处分身定制**的，不能用于任意确认；`$PI/dist/core/extensions/runner.js` 的 `emitProjectTrustEvent` 只跑第一条 `trusted !== "undecided"` 的结果。
- **无界面子会话的生态惯例（父侧兜底）**：官方 `examples/extensions/subagent/index.ts`
  - `:300` 子 agent 以 **`["--mode","json","-p","--no-session"]`** 启动 → 子会话 `hasUI=false`、`ui.confirm` 恒 `false`
  - `:523,538` 由**父扩展**在 TUI 里做 `ctx.hasUI && await ctx.ui.confirm("Run project-local agents?", ...)`
  → 官方认可的模式就是"**子会话无 UI 能力 → 父会话负责确认**"，但**父会话是在子进程启动前/由父自行决定**，不是子会话运行中把请求上抛。
- 观测钩子（可做"注意力信号"，不能做代理）：`ui_prompt_start`/`ui_prompt_end`（见 Q1e）。

---

### Q5 `pi.events` 是否跨进程/跨子代理；`pi-intercom` / `contact_supervisor` 是否 Pi 内置

**a. `pi.events` = 进程内 EventBus** 【已证实】

`$PI/dist/core/extensions/types.d.ts:1158`
```ts
/** Shared event bus for extension communication. */
events: EventBus;
```
`$PI/dist/core/event-bus.d.ts`
```ts
export interface EventBus { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void; }
export interface EventBusController extends EventBus { clear(): void; }
export declare function createEventBus(): EventBusController;
```
实现无 socket/无 fs/无 IPC，只是内存 Map；`ExtensionRuntimeState.trackEventBusSubscription`（`types.d.ts:1311-1312`）只做生命周期清理。
→ **同进程内多个扩展共享；不跨进程**。官方示例 `examples/extensions/event-bus.ts` 就只演示"同进程内一个扩展 emit、另一个扩展 on"，并用 `currentCtx?.ui.notify` 展示。
→ **跨子代理（= 跨 `pi` 子进程）不成立**：`examples/extensions/subagent/index.ts` 用 `spawn` 起独立 `pi` 进程，父子之间只有 stdout/stderr 文本 + 退出码，没有任何事件总线。

**b. `pi-intercom` / `contact_supervisor`** 【已证实非 Pi 内置 / 本机未见；标注：非官方】

- `$PI` 全包（`dist/` + `docs/` + `examples/` + `README.md` + `CHANGELOG.md`）检索 `intercom` / `contact_supervisor`：**零命中**。
- 本仓库 `/Users/lystran/programming/ai/pi-extensions`（排除 `node_modules`）检索：只有 `docs/research/pi-session-rename-prompt.md:830` 出现 `contact_supervisor`，且是为"未使用它"的说明。`plugins/` 只有 `mvn-compact / pi-guard / pi-session-rename / serena-hooks / statusline`。
- `~/.pi/agent` 下无 intercom 相关安装；`~/.pi/agent/packages` 为空。
→ **二者都不是 Pi 内置 API**。`contact_supervisor` 是 **agent 编排层（本会话的 supervisor/intercom 通道）** 的工具，`pi-intercom` 也不是本机任何 Pi 包；属于**非官方生态/宿主自建**。本机 Pi 0.87.1 未提供任何等价内置物。

---

### Q6 若官方无代理通道：检索过的关键词与目录，区分"未找到"与"已证明不存在"

先区分语义：
- **未找到**：我用了该关键词但可能词形/命名不符，不能断言不存在（如 `escalate*`、`proxy*`、`delegate*` 这类自由命名）。
- **已证明不存在**：检索空间是**完整的已发布包**（`dist/` 全部 + `docs/` 39 文件 + `examples/` 全量 + `README.md`/`CHANGELOG.md`），且目标是一个**必须出现在类型声明或协议里的具名符号**——若类型/协议里都没有，就可以判定该 API 不存在（扩展 API 面由 `dist/**/*.d.ts` + `dist/index.d.ts` 穷尽定义）。

| 关键词 | 检索目录 | 命中 | 判定 |
|---|---|---|---|
| `hasUI` | `dist/`(含 .d.ts/.js)，`docs/`，`examples/` | 30+ | 已证实（Q1b） |
| `ExtensionMode` / `"tui" \| "rpc" \| "json" \| "print"` | 同上 | 有 | 已证实（Q1a） |
| `bindExtensions` | `dist/**/*.d.ts`，`dist/core/agent-session.js`，`dist/modes/*` | 有 | 已证实（Q2a） |
| `uiContext` | `dist/core/sdk.d.ts`、`resource-loader.d.ts`、`agent-session-services.d.ts` | **0** | 已证明不存在（SDK 层无 UI 选项） |
| `setUIContext` | `dist/`（全部 `.js`） | 3（runner 内部） | 已证实：只有模式层/runner 内部用，不对外 |
| `extension_ui_request` / `RpcExtensionUIRequest` | `dist/modes/rpc/`，`docs/rpc-extension-ui.md`，`examples/rpc-extension-ui.ts` | 有 | 已证实（Q3） |
| `extension_ui`（在 `rpc-client.d.ts`/`rpc-client.js` 中） | `dist/modes/rpc/rpc-client.*` | **0** | 已证明不存在（RpcClient 无 UI API，但 `handleLine` 会转发未知记录） |
| `ui_prompt_start` / `ui_prompt_end` | `dist/`，`docs/` | 类型里有，**docs 0** | 已证实公开导出但**未文档化** |
| `requestApproval` | `dist/`、`docs/`、`examples/` | **0** | 已证明不存在（无此具名 API；换名也需落在类型面里） |
| `escalate` | 同上 | 0 | **未找到**（自由词形，不能断言绝对不存在） |
| `delegateApproval` / `forwardApproval` / `proxyUI` / `ask host` | 同上 | 0 | **未找到** |
| `project_trust`（宿主代答模型） | `dist/core/extensions/*` | 有 | 已证实存在但仅限信任场景（Q4） |
| `intercom` / `contact_supervisor` | `$PI` 全包 + 本项目（除 node_modules） + `~/.pi/agent` | 仅 1 处说明性引用 | 已证明非 Pi 内置（Q5b） |
| `headless` | `$PI` 全包 | 10，全是 RPC/clipboard/OAuth 语境 | 已证实：`headless`≠"无界面会话上抛"，无该语义 |
| `parentSession` | `$PI` 全包 | 37，全是会话文件/分叉语境 | 已证实：与 UI 无关 |
| `--mode json -p`（子会话启动方式） | `examples/extensions/subagent/index.ts:300` | 有 | 已证实（Q4 生态惯例） |

检索目录清单（全部只读命令）：
- `$PI/dist`（递归，`--include=*.d.ts` 与 `--include=*.js`）
- `$PI/dist/core/extensions/{types,runner,index}.d.ts|js`
- `$PI/dist/core/{sdk,agent-session,resource-loader,event-bus}.d.ts|js`
- `$PI/dist/modes/{print-mode,rpc/rpc-mode,rpc/rpc-types,rpc/rpc-client,interactive/interactive-mode}.js|d.ts`
- `$PI/docs`（全 39 文件；逐文件读 `extensions.md`、`rpc-extension-ui.md`、`rpc.md`、`cli-integration.md`、`sdk.md`）
- `$PI/examples`（`examples/rpc-extension-ui.ts`、`examples/extensions/{event-bus,confirm-destructive,permission-gate,dirty-repo-guard,project-trust,rpc-demo,widget-placement,subagent/index}.ts`）
- `$PI/README.md`、`$PI/CHANGELOG.md`
- `/Users/lystran/programming/ai/pi-extensions`（排除 `node_modules`）、`~/.pi/agent`

---

## 3) 可用与不可用通道

### 可用（本机 0.87.1 已证实）

| # | 通道 | 形状 | 适用面 | 关键限制 |
|---|---|---|---|---|
| U1 | **RPC 扩展 UI 子协议** | 子进程 `pi --mode rpc`；Pi→宿主 `extension_ui_request`（JSONL on stdout），宿主→Pi `extension_ui_response`（JSONL on stdin，按 `id` 配对） | **无界面子会话把 `confirm/select/input/editor/notify` 交给宿主**——正是本任务的目标形态 | 需要宿主实现 JSONL 循环；不传 `timeout` 会永久阻塞；`custom()` 等 TUI-only 能力降级；`RpcClient` 无现成 UI API（要自写/自扩） |
| U2 | **宿主注入自定义 `ExtensionUIContext`**（SDK 路径） | `session.bindExtensions({ uiContext, mode })`，`uiContext` 可完全自定义（例如转发给父进程） | 进程内集成、自建宿主 | 只有**宿主**能做；扩展自己拿不到 `session`/`bindExtensions`；`createAgentSession` **无** UI 选项 |
| U3 | **能力探测 + 自行降级**（官方约定） | `ctx.hasUI`（tui/rpc=true；json/print=false）、`ctx.mode === "tui"` | 所有扩展的安全写法 | 只能"跳过或兜底"，**不能上抛** |
| U4 | **父会话预先确认**（官方示例惯例） | 父扩展在自己有 UI 时先 `ctx.ui.confirm`，再 `spawn("pi", ["--mode","json","-p",...])` 跑无 UI 子会话 | 子代理/子任务编排 | 确认发生在子会话启动**之前**；子会话运行中无法再求助 |
| U5 | **`pi.events`（进程内）** | `pi.events.emit/on(channel, data)` | 同进程多扩展协作（可做父扩展↔子扩展桥，**前提是同进程**） | **不跨进程**；跨 `spawn` 子代理无效 |
| U6 | **`ui_prompt_start` / `ui_prompt_end` 观测** | `pi.on("ui_prompt_start", ...)`，`queueMicrotask` 异步发 | 让宿主/其他扩展知道"有人正在等 UI"（可做注意力信号/通知） | **只读**，无法提供答案；仅同 session 同进程；未文档化 |
| U7 | **`project_trust` 事件代答** | handler 收 `ctx.ui: Pick<...,"select"|"confirm"|"input"|"notify">`，返回 `{trusted, remember?}` | Pi 内置的"宿主代答"唯一先例，可作为自研协议的设计参考 | **仅 project trust 一个场景**，通用确认不适用 |

### 不可用（本机 0.87.1 不存在）

- **X1** 官方通用 `requestApproval`/`escalate`/代理 UI 事件（扩展 → 父会话/宿主的通用上抛）——类型面与协议里都没有。
- **X2** 扩展侧自行改写自己的 UI 上下文（无 `bindExtensions`/`session`/`setUIContext` 暴露）。
- **X3** `createAgentSession({ ui | uiContext | mode })`——不存在。
- **X4** `pi.events` 跨进程 / 跨子代理。
- **X5** 无界面子会话（`--mode print|json`）自动回落到父会话：其 `ctx.ui.confirm` 恒 `false`、`notify` 静默丢弃。
- **X6** `pi-intercom` / `contact_supervisor` 作为 Pi API（非官方，非内置）。
- **X7** `RpcClient.onEvent` 的类型化 UI 支持（记录确实会被转发，但类型是 `JsonAgentSessionEvent`，且无发送响应的公开方法）。

### 对"无界面子会话上抛确认"的可行组合（推论，非官方 API）

1. 子进程以 `--mode rpc` 启动（**不是** `print/json`），宿主在其 stdout 收 `extension_ui_request(method:"confirm")` → 宿主（或宿主代理给父 TUI）回 `extension_ui_response({id, confirmed})`。**这是唯一完全落在官方协议内的路径**，但 `ctx.mode === "rpc"`、`hasUI === true`，所以子会话里的扩展会以为"有 UI"。
2. 进程内嵌：父进程建子 `AgentSession`，`bindExtensions({ uiContext: 转发给父 TUI 的实现, mode: "rpc" })`。
3. `--mode print/json` 子会话 **无法**上抛；只能靠 U4（父先确认）或 U3（子自己按策略 deny/allow）。

---

## 4) 未确证项

1. **pi.dev 官方在线文档未核验**：本轮 scouting 运行**没有 web fetch 工具**（可用工具仅 `read/find/ls/bash/write/grep/contact_supervisor`）。因此"pi.dev 上是否有本机 0.87.1 尚未包含的更新机制"**无法回答**。所有结论均来自本机 0.87.1 已发布包，符合"本机 API 与在线文档冲突时以本机公开 API 为准"的项目约定；但"**本机 docs 里没有**"在此语境下应读作"本机包内 39 个 docs 文件 + 类型声明里没有"，不等于"官方从未在任何版本/页面写过"。
2. **`ui_prompt_start`/`ui_prompt_end` 未文档化**：类型与 `on()` 重载都在公开导出面（`dist/index.d.ts:8`、`types.d.ts:1002-1003`），但 `docs/` 内零命中。是否被视为"稳定公开 API"未确证（也无版本稳定性声明）。
3. **`ExtensionUIContext` 的"自定义实现被接受度"未做运行时实测**：本机代码读得到的注入点只有 `bindExtensions.uiContext`，但未被 `runner.setUIContext` 之外的路径校验；本轮为只读取证，**未编译运行**任何 PoC（符合只读约束）。
4. **RPC 子会话"扩展以为有 UI"的语义风险未实测**：`rpc-mode.js` 明确给 `mode:"rpc", hasUI:true`，但若宿主不实现 UI 循环，dialog 会永久挂起（无 `timeout` 时）。该挂起行为由代码路径推断，未实测。
5. **`escalate` / `proxyUI` 等自由命名关键词为"未找到"而非"已证明不存在"**：如果官方用了完全不同的命名，我的关键词集可能漏掉；但任何"扩展可调用的新 API"都必须出现在 `dist/**/*.d.ts` 导出面，我已对该面做了穷尽扫描，故实际风险低。
6. **`contact_supervisor` 的完整来源**未确证（本机未定位到其实现文件）；仅能确证它不在 Pi 包与本仓库插件内。

---

## 5) 检索位置清单（命令原文）

**基线**
```bash
node -p "require('$PI/package.json').version"          # -> 0.87.1
find "$PI/docs" -type f                                 # -> 39 files
ls "$PI/dist"                                           # core/ modes/ extensions/ bundle/ cli/ utils/
```

**Q1**
```bash
sed -n '1,260p'   "$PI/dist/core/extensions/types.d.ts"          # ExtensionUIContext, ExtensionMode, ExtensionContext  :209-216, confirm :72-73
sed -n '128,160p' "$PI/dist/core/extensions/runner.js"          # noOpUIContext, confirm->false :134
sed -n '195,205p' "$PI/dist/core/extensions/runner.js"          # ctor: uiContext = noOpUIContext :199
sed -n '305,356p' "$PI/dist/core/extensions/runner.js"          # setUIContext :315, wrapUIPromptContext :313, withUIPrompt :331
sed -n '360,366p' "$PI/dist/core/extensions/runner.js"          # hasUI() :363
sed -n '540,610p' "$PI/dist/core/extensions/runner.js"          # createContext() getters ui/mode/hasUI :549-570
sed -n '1428,1442p' "$PI/dist/modes/interactive/interactive-mode.js"   # bindExtensions({uiContext, mode:"tui"}) :1434
sed -n '40,75p'   "$PI/dist/modes/print-mode.js"                # bindExtensions({mode}) 无 uiContext :53
grep -n "uiContext\|mode\b\|extension_ui_request" "$PI/dist/modes/rpc/rpc-mode.js"  # :230-232, :77,90,104,127,146,163,191
```

**Q2**
```bash
sed -n '143,178p' "$PI/dist/core/agent-session.d.ts"            # ExtensionBindings :143
grep -n "bindExtensions" "$PI/dist/core/agent-session.d.ts"      # :597
sed -n '2293,2312p;2355p' "$PI/dist/core/agent-session.js"       # 实现 + _applyExtensionBindings -> setUIContext
grep -n "interface CreateAgentSessionOptions" -A 80 "$PI/dist/core/sdk.d.ts"   # :10-56 无 ui/mode
grep -rn "uiContext\|hasUI\|extensionUI" "$PI/dist/core/sdk.d.ts" "$PI/dist/core/resource-loader.d.ts" "$PI/dist/core/agent-session-services.d.ts"  # 0
grep -n "InlineExtension" -A 12 "$PI/dist/core/extensions/types.d.ts"          # :1241-1247
```

**Q3**
```bash
sed -n '380,480p' "$PI/dist/modes/rpc/rpc-types.d.ts"           # RpcExtensionUIRequest/Response :393-475
sed -n '25,235p'  "$PI/dist/modes/rpc/rpc-mode.js"              # createDialogPromise :48, confirm :80, notify :85…
grep -n "extension_ui\|RpcExtensionUI\|uiRequest" "$PI/dist/modes/rpc/rpc-client.d.ts"  # 0
grep -in "ui" "$PI/dist/modes/rpc/rpc-client.d.ts"              # 0  (RpcClient 无 UI API)
sed -n '405,440p' "$PI/dist/modes/rpc/rpc-client.js"            # handleLine 把非 response 记录丢给 listeners
sed -n '1,200p'   "$PI/docs/rpc-extension-ui.md"
grep -n "extension_ui" "$PI/docs/rpc.md" "$PI/docs/rpc-commands.md"
grep -n "artifact\|RPC commands can change models\|Extension dialogs form" "$PI/docs/cli-integration.md"   # :68,70
grep -n "extension_ui_request\|extension_ui_response" "$PI/examples/rpc-extension-ui.ts"  # :394,402-405,414,426,540
grep -n "RpcClient\|RpcExtensionUI" "$PI/dist/index.d.ts"        # :28
```

**Q4 / Q6（关键词穷尽）**
```bash
for kw in escalate requestApproval delegateApproval parentSession headless "ask host" proxyUI forwardApproval; do
  grep -rni "$kw" "$PI/dist" "$PI/docs" "$PI/examples" | grep -v "\.map:" | wc -l
done
grep -rni "intercom\|contact_supervisor\|requestApproval\|approval" "$PI/dist" "$PI/docs" "$PI/examples" "$PI/README.md" "$PI/CHANGELOG.md" | grep -v "\.map:"
grep -rn "ui_prompt" "$PI/dist" --include=*.d.ts                 # types.d.ts:629-641, 1002-1003
grep -rn "ui_prompt_start" "$PI/docs"                             # 0
sed -n '629,641p' "$PI/dist/core/extensions/types.d.ts"           # UIPromptStart/EndEvent
sed -n '392,403p' "$PI/dist/core/extensions/types.d.ts"           # ProjectTrustContext（宿主代答唯一先例）
sed -n '189,193p' "$PI/docs/extensions.md"                        # 官方 mode/hasUI 约定
grep -rn "hasUI" "$PI/examples/extensions/"*.ts                   # 各示例的 !ctx.hasUI 守卫
sed -n '292,320p;500,545p' "$PI/examples/extensions/subagent/index.ts"  # :300 --mode json -p; :523,538 父侧 confirm
```

**Q5**
```bash
cat   "$PI/dist/core/event-bus.d.ts"                              # EventBus/EventBusController
sed -n '1140,1160p' "$PI/dist/core/extensions/types.d.ts"         # :1158 events: EventBus
cat   "$PI/examples/extensions/event-bus.ts"
grep -rn "intercom\|contact_supervisor" <repo> --include=*.ts --include=*.md --include=*.json | grep -v node_modules
find ~/.pi -maxdepth 4 -iname "*intercom*"                        # 空
ls ~/.pi/agent/packages                                          # 空
```

---

## 6) 参考

本机 0.87.1（最高优先级）
- `$PI/dist/core/extensions/types.d.ts` — `ExtensionMode:209`、`ExtensionUIContext:63-193`、`confirm:72-73`、`ExtensionContext:210-248`、`ProjectTrustContext:392-403`、`UIPromptStart/EndEvent:629-641`、`ExtensionEvent:879`、`ExtensionAPI:978-1159`、`events:1158`、`InlineExtension:1241-1247`
- `$PI/dist/core/extensions/runner.js` — `noOpUIContext:132-160`、`ctor:196-202`、`setUIContext:315`、`withUIPrompt:331-352`、`hasUI:363`、`createContext:549-570`
- `$PI/dist/core/agent-session.d.ts:143` / `$PI/dist/core/agent-session.js:2293,2355` — `ExtensionBindings` / `bindExtensions`
- `$PI/dist/core/sdk.d.ts:10-56,61-62` — `CreateAgentSessionOptions` 无 UI 项
- `$PI/dist/core/event-bus.d.ts`、`$PI/dist/index.d.ts:8,18,19,28`
- `$PI/dist/modes/print-mode.js:53`、`$PI/dist/modes/rpc/rpc-mode.js:48-232`、`$PI/dist/modes/rpc/rpc-types.d.ts:393-475`、`$PI/dist/modes/rpc/rpc-client.d.ts|js:409-424`、`$PI/dist/modes/interactive/interactive-mode.js:1434`
- `$PI/docs/extensions.md:189-193`、`docs/rpc-extension-ui.md`（全文）、`docs/rpc.md:33,68`、`docs/cli-integration.md:68,70`、`docs/sdk.md:112`
- `$PI/examples/rpc-extension-ui.ts:52,394,402-405,414,426,540`、`examples/extensions/subagent/index.ts:300,523,538`、`examples/extensions/event-bus.ts`、`examples/extensions/{confirm-destructive,permission-gate,dirty-repo-guard,project-trust,rpc-demo}.ts`

本仓库既有调研（交叉参考）
- `docs/research/destructive-command-guard-pi-permission.md:55,73,94,110` — 早已记录"非交互模式用 `ctx.hasUI` 分支 + headlessPolicy 默认 deny"，与本轮 Q1/Q4 一致
- `docs/research/rpiv-ask-user-question-attention-signals.md:94,117` — 另一处 `!ctx.hasUI` 守卫实例

官方链接索引（本机 `docs/` 内的外链，未在线核验）
- `docs/rpc-extension-ui.md` 末尾指向 `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-types.ts` 与 `examples/rpc-extension-ui.ts`、`examples/extensions/rpc-demo.ts`
- 包内未见 `homepage`/`repository` 之外的 pi.dev 页面索引；本报告未访问 pi.dev（无 fetch 工具，见第 4 节第 1 条）

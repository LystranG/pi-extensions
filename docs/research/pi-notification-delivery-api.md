# 调研：Pi 0.87.1 的「通知投递 API 面」

> 调研日期：2026-09（本机 npm registry `latest` = 0.87.1，与本机安装一致）。
> 调研问题：Pi 0.87.1 是否存在公开 API（扩展 API / RPC 协议 / settings / 环境变量 / CLI）可投递一条「能触达没有在看 Pi 终端的用户」的通知。
> 证据等级标注：
> - **【源码证实】** = 直接读到实现/类型原文（附 `文件:行号`）
> - **【文档证实】** = 官方文档/settings/CLI 原文
> - **【在线源码证实】** = 读到 GitHub `main` 上的源码/CHANGELOG 原文（可能存在版本漂移，已逐处标注）
> - **【源码推断】** = 由已读代码推导，未读到目标调用点
> - **【未证实】** = 本轮未取得证据
>
> 主源根目录（下文简称 `PKG`）：
> `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-coding-agent`
> TUI 包（下文简称 `TUI`）：`.../node_modules/@earendil-works/pi-tui`
> 行号说明：本机包为 tsc 未打包产物（`dist/**/*.js`、`dist/**/*.d.ts`），行号均取自本次 `read` 的分页读取（`offset` 即真实行号）；`dist/bundle/*.js`（同源打包产物）未作为证据。

---

## 摘要

**结论：没有。** Pi 0.87.1 **不存在**任何「把一条通知投递到用户可见处、且不依赖用户正在盯着 Pi 终端」的公开 API。三类候选通道逐条判定：

- **(a) 操作系统级桌面通知（macOS 通知中心 / libnotify / Windows toast）：无 API。** 核心进程自己也不发系统通知，只写终端；若要发系统通知，只能用扩展自己 `spawn` 一个系统通知进程（这正是 pi-guard 现在的做法）。
- **(b) 终端模拟器级通知（OSC 9 / 777 / 99 / kitty 转义序列）：无 API。** `@earendil-works/pi-tui` 的公开导出里**没有**任何 OSC 通知原语或 BEL 原语，唯一的 OSC 写点是 `setTitle`（OSC 0）与 `setProgress`（OSC 9;4 进度）。**但是**（本次最重要的修正）Pi 通过 `ctx.ui` 的组件工厂把真实 `TUI` 实例交给扩展，而 `TUI.terminal: Terminal` 提供 `write(data: string)` → `process.stdout.write(data)`：这是一条**未写进文档但类型公开**的「写任意转义序列」路径。上游自己的示例扩展 `examples/extensions/notify.ts` 更直接：用 `process.stdout.write` 写 OSC 777 / OSC 99 / PowerShell toast。
- **(c) 经 RPC 协议转发给外部宿主：只有 `notify`（fire-and-forget），且 Pi 不自带会把它变成系统通知的客户端。** RPC 命令集（客户端 → Pi）里没有任何 notification 类命令。

**上游意图同样明确「通知交给扩展」**：把 `bell()` 加进扩展 UI 上下文的 PR [#462](https://github.com/earendil-works/pi/pull/462) 被维护者以「我宁愿它是一个简单扩展」拒绝（2026-01-05）；「`agent_end` 时通知」的 issue [#5788](https://github.com/earendil-works/pi/issues/5788) 未处理（`NOT_PLANNED`，机器人自动关闭）；而 OSC 777 示例扩展 PR [#658](https://github.com/earendil-works/pi/pull/658) 被**合并**（2026-01-12）。

对 pi-guard 的含义（详见第 11 节）：**现有「spawn 独立系统通知进程」降级链仍然必要**——它是三类通道里唯一能保证「触达 + 可探测失败」的手段；OSC 通道只能作为可选的、零依赖的第二层前置，不能替代系统通知。

---

## 0. 方法与本次「新增/修正」

### 0.1 证据基础与复核结果

任务指定的本地证据文件 `/tmp/pi-notify-local-evidence.md` **本轮读取时不存在**（`E_NOT_FOUND`）。因此本报告的所有结论都改由**本次自行读取原始文件**得出；只把前置摘要当作「待验证线索」。抽样复核（≥5 条，用 `read` 打开原文）结果：

| # | 前置证据声称 | 本次复核 | 判定 |
|---|---|---|---|
| 1 | `interactive-mode.js:1981 notify: (message, type) => this.showExtensionNotify(...)` | `:1981` 逐字相同 | ✅ 相符 |
| 2 | `interactive-mode.js:2225 showExtensionNotify(message, type)` | `:2225` 签名与 `:2226-2234` 三分支逐字相同 | ✅ 相符 |
| 3 | `interactive-mode.js:2998 showStatus(message)` 复用同一 Text 节点 | `:2998` 签名、`:2995-2997` 注释（"avoid log spam"）相符 | ✅ 相符 |
| 4 | `interactive-mode.js:3666 this.chatContainer.addChild(new Text(... "Error: "...))` | `showError` 签名在 `:3666`，但该 `addChild(new Text(...))` 实际在 **`:3668`**（`showWarning` 在 `:3671`，与前置一致） | ⚠️ **行号偏移 2 行，语义不变（已纠正）** |
| 5 | `TUI/dist/terminal.js:419 setProgress(active)` | `setTitle` 在 `:414`、OSC 0 写在 `:416`、常量在 `:7-:9` 均相符；`setProgress` 实际在 **`:418`** | ⚠️ **行号偏移 1 行（已纠正）** |
| 6 | `print-mode.js:53-55 await session.bindExtensions({ mode: ... })` 无 `uiContext` | `await session.bindExtensions({` 在 `:54`、`mode: ...` 在 `:55`；确实没有 `uiContext` 字段 | ✅ 相符（行号按本次读取为准） |
| 7 | （前置未包含）`noOpUIContext.notify` 的实现 | `runner.js:136 notify: () => { },`（`noOpUIContext` 定义 `:130-161`） | 🆕 本次新增核实 |
| 8 | （前置未包含）`TUI.terminal: Terminal` / `Terminal.write()` | `TUI/dist/tui.d.ts` 的 `interface TUI` 含 `terminal: Terminal`；`TUI/dist/terminal.d.ts` 的 `interface Terminal` 含 `write(data: string)`；`TUI/dist/terminal.js:371-372` 实现为 `process.stdout.write(data)` | 🆕 本次新增核实（**影响结论**） |

结论：前置证据的**语义与文本引用可靠**，仅个别行号有 1–2 行偏移。本报告不继承其「Pi 没有暴露写转义序列的公开 API」这一判断（见 0.2）。

### 0.2 相对两份前置调研，本次新增 / 修正了什么

**对 `docs/research/pi-guard-notification-os-mechanisms.md`（基线 0.84.2，结论「不应在插件里直写 OSC，推荐 spawn 独立系统通知进程」，并声称「Pi 没有暴露任何写转义序列的公开 API」）：部分推翻。**

1. **成立的部分**：在 **`ExtensionUIContext` 这一层**，0.87.1 依然只有 `setTitle` 一个会写 OSC 的方法，没有任何 `writeEscapeSequence` / `terminalSequence` / `bell()` API。这一半结论不变。
2. **被推翻的部分（0.87.1 基线）**：「必须绕过 TUI 直接写 `process.stdout` 或 `/dev/tty`」不再准确。扩展可以通过**公开类型**拿到 TUI 再写：
   - `@earendil-works/pi-tui` 是官方文档化的扩展 UI 库（`PKG/docs/tui.md` 首句 + 末段「The public exports are defined in `packages/tui/src/index.ts`」）【文档证实】；
   - `TUI` 接口公开成员 `terminal: Terminal`，`Terminal` 公开成员 `write(data: string)`、`setTitle(title)`、`setProgress(active)`【源码证实】；
   - Pi 把**真实 TUI 实例**交给扩展的组件工厂（实测到 `interactive-mode.js:2163 const newEditor = factory(this.ui, getEditorTheme(), this.keybindings)`，`this.ui` 即 `TUI`；`ctx.ui.custom/setWidget/setFooter/setHeader/setEditorComponent` 的工厂签名同样接收 `tui: TUI`，见 `types.d.ts:112-118`）【源码证实】；
   - 因此 `tui.terminal.write("\x1b]777;notify;title;body\x07")` 是一条**不需要「绕过」的路径**（字节落点与直写 stdout 相同，但入口是公开类型成员）。
   **【源码推断】**：`Terminal.write` 未被 `docs/tui.md` 记录为「供扩展使用的 API」，`ProcessTerminal` 也是为「Pi 自己创建终端」设计的；因此它属于「类型公开、文档未承诺」的灰色地带，`TUI.terminal` 字段是否会被上游视为稳定 API 无法保证。
3. **新增事实（同一基线 0.84.2 也成立）**：上游**从 2026-01 起就把「扩展直写 OSC」当成官方示例做法**——`examples/extensions/notify.ts` 在 pi-guard 依赖的 0.84.2 安装里已存在（我核对了 `plugins/pi-guard/node_modules/@earendil-works/pi-coding-agent/examples/extensions/notify.ts`，其内容是 `process.stdout.write("\x1b]777;notify;...")` / `"\x1b]99;..."` + PowerShell toast，挂在 `agent_end`），PR [#658](https://github.com/earendil-works/pi/pull/658) 于 2026-01-12 被合并【在线源码证实】。所以「插件不该直写 OSC」是一条**工程判断**，不是「Pi 没有这条路」的事实陈述。前置报告对 OSC 撕裂/与 CSI 2026 原子帧竞争的风险分析仍是【源码推断】，本轮**既未证实也未推翻**（官方示例是 demo，不是渲染安全性的承诺；`PKG/docs/terminal-setup.md:219` 反而提醒 "Unsupported escape sequences can corrupt rendering"）。
4. **新增**：核心**不会**在 agent 结束或等待用户时响铃（BEL），也不写 OSC 9/777/99 通知；`terminal.showTerminalProgress` 是 OSC **9;4 进度**，与「OSC 9 通知」是不同的序列（见第 2 节）。
5. **新增**：RPC 通道的实际触达范围（Pi 自带示例客户端把 `notify` 渲染成终端内一行文本，不做系统通知，见 1.2 / 第 4 节）。

**对 `docs/research/pi-guard-notification-pi-api.md`（`ui_prompt_start` / `ui_prompt_end`）**：本报告不重复其内容；仅把它当作已知事实（该事件是「扩展 `ctx.ui` 阻塞式提示」的观测点，由 0.84.4 引入）。它与本报告的正交点是：**该事件只解决「何时通知」，不提供「如何投递通知」**。本轮顺带核实了一项与之相关的版本事实：`action: "end"`/`agent_settled` 语义在 0.87.x 仍有效（官方示例 `notify.ts` 在 0.87.1 里已从 `agent_end` 改为 `agent_settled`，见 6.3）。

---

## 1. 子问题 1：`ctx.ui.notify(message, type?)` 的真实投递路径

### 1.1 TUI 模式（`ctx.mode === "tui"`）

**调用链**【源码证实】：

```
ctx.ui.notify(message, type)
  PKG/dist/modes/interactive/interactive-mode.js:1981   notify: (message, type) => this.showExtensionNotify(message, type)
  → :2225 showExtensionNotify(message, type)
        type === "error"   → :3666 showError(message)     → chatContainer += Spacer(1) + Text("Error: " + msg, error 色)
        type === "warning" → :3671 showWarning(message)   → chatContainer += Spacer(1) + Text("Warning: " + msg, warning 色)
        其他(info)         → :2998 showStatus(message)    → chatContainer += Spacer(1) + Text(dim 色)
  → 每个分支末尾 this.ui.requestRender()
```

- **显示位置**：`chatContainer`（终端内的聊天记录/transcript 区）里追加 pi-tui 的 `Spacer` + `Text` 组件【源码证实 `:2998-3012`、`:3666-3674`】。fullscreen 模式下该容器由 transcript `ScrollView` 承载（**【在线源码证实】** `interactive-mode.ts`：`private transcriptScrollView: TuiLayouts.ScrollView | undefined`）。
- **是否自动消失**：**不会**。三个分支都没有 timer/超时/删除逻辑；`showStatus` 只是在「连续两次状态之间没有别的内容」时复用同一个 `Text` 节点以避免刷屏（注释原文："If multiple status messages are emitted back-to-back … we update the previous status line instead of appending new ones to avoid log spam."，`:2995-2997`）——旧文本被**覆盖**，但仍留在 transcript 中【源码证实】。
- **是否写 OSC / BEL**：**否**。整条路径只做「往 chatContainer 加组件 + `requestRender`」，没有任何转义序列写入；`notify` 的实现里没有 OSC/BEL【源码证实 `:1976-1996`、`:2225-2235`、`:2998-3012`、`:3666-3674`】。（对照：本机 `interactive-mode.ts` 全文件文本检索对 `bell`、`\u0007` **零匹配**【在线源码证实】，见 2.4。）
- **无 UI 时**：`noOpUIContext.notify = () => { }`（`runner.js:136`）【源码证实】。

### 1.2 RPC 模式（`ctx.mode === "rpc"`）

- **协议语义**【文档证实】`PKG/docs/rpc-extension-ui.md`：扩展 UI 方法分两类——**dialog**（`select`/`confirm`/`input`/`editor`，走 `extension_ui_request` + 等 `extension_ui_response`）与 **fire-and-forget**（`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`）。原文：
  > "**Fire-and-forget methods** (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`): emit an `extension_ui_request` on stdout but do not expect a response. **The client can display the information or ignore it.**"
- **线上格式**【源码证实】`PKG/dist/modes/rpc/rpc-types.d.ts`（整文件通读）：
  `{ "type": "extension_ui_request", "id": string, "method": "notify", "message": string, "notifyType"?: "info"|"warning"|"error" }`；文档补充 `notifyType` 缺省为 `"info"`（`docs/rpc-extension-ui.md`）。
- **Pi 是否自带「会把它显示成原生通知」的客户端**：**否**。
  - `ctx.mode === "rpc"` 时 `ctx.hasUI === true`（文档原文："Note: `ctx.mode` is `"rpc"` and `ctx.hasUI` is `true` in RPC mode because the dialog and fire-and-forget methods are functional via the extension UI sub-protocol."）【文档证实】——注意这只是说「协议通道可用」，不代表有人把它渲染成系统通知。
  - Pi 自带的示例客户端 `PKG/examples/rpc-extension-ui.ts`（文档 `docs/rpc-extension-ui.md` 明确指向它）在 `handleExtensionUI` 里对 `case "notify"` 的处理是 **`outputLog.append("Notification: " + req.message)` + `tui.requestRender()`**，即**在自己 TUI 的输出日志里追加一行彩色文本**；`setStatus`/`setWidget` 同样被当成「Notification:」行打印。全文没有 `notify-send` / `osascript` / OSC 通知序列【源码证实 + 在线源码证实（main 版同文件内容一致）】。
  - `RpcClient` 是**库**（"starts Pi, correlates responses, exposes typed command methods, and delivers events to listeners"，`docs/rpc.md`）【文档证实】，它只负责把事件投递给宿主代码，本身不做展示。

### 1.3 JSON / print 模式

- **是 no-op**【源码证实】：
  - `print-mode.js:54-55`：`await session.bindExtensions({ mode: mode === "json" ? "json" : "print", commandContextActions: {...}, onError })`——**没有 `uiContext` 字段**；`ExtensionRunner` 收到 falsy 时保持/回落到 `noOpUIContext`（`runner.js:315`，`this.uiContext = uiContext ? this.wrapUIPromptContext(uiContext) : noOpUIContext`）。
  - `noOpUIContext.notify = () => { }`（`runner.js:136`）。
  - 文档侧一致【文档证实】`docs/extensions.md` 模式表：`json` → `ctx.hasUI === false`，"UI methods are no-ops"；`print` → 扩展会运行但 "can't prompt"。
  - 因此 print/json 下 `ctx.ui.notify` 既**不输出**也不报错，完全静默。

### 1.4 小结

| 模式 | `notify` 落点 | 用户可见性 | 会写 OSC/BEL |
|---|---|---|---|
| `tui` | chatContainer 里的 dim/error/warning `Text`（不自动消失） | 仅在 Pi 界面内 | **否** |
| `rpc` | stdout 的 `extension_ui_request{method:"notify"}` | 取决于宿主；官方示例客户端只打印文本 | **否**（是 JSON） |
| `json` / `print` | 无（`noOpUIContext`） | 无 | 否 |

---

## 2. 子问题 2：Pi 核心自身是否存在「通知用户」功能

### 2.1 `docs/settings.md` 的全部 `terminal.*` 配置

【文档证实】`PKG/docs/settings.md:86-92`（原文表格）：

| Setting | Type | Default | Description |
|---|---|---|---|
| `terminal.showImages` | boolean | `true` | Display inline images when supported. |
| `terminal.imageWidthCells` | number | `60` | Preferred inline image width in terminal cells. |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when rendered content shrinks. |
| `terminal.showTerminalProgress` | boolean | `false` | **Show OSC 9;4 progress in the terminal tab.** |
| `terminal.hyperlinks` | `boolean \| "auto"` | `"auto"` | Override OSC 8 hyperlink detection. |
| `terminal.images` | `"kitty" \| "iterm2" \| "auto" \| false` | `"auto"` | Override inline-image protocol detection. |
| `terminal.trueColor` | `boolean \| "auto"` | `"auto"` | Override true-color detection. |

`settings.md` 全文（本机副本 150 行）已通读：**不存在**任何 `*notify*` / `*bell*` / `*notification*` 设置。与「提示类输出」沾边的只有 `showCacheMissNotices`（`:22`，缓存未命中的**终端内**提示文本）和 `collapseChangelog`。

**`terminal.showTerminalProgress` 与「OSC 9 通知」是两回事**【源码证实】：它写的是 OSC **9;4**（ConEmu/xterm 风格进度条），常量在 `TUI/dist/terminal.js:7-9`：
```js
const TERMINAL_PROGRESS_KEEPALIVE_MS = 1000;
const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";   // 不确定进度
const TERMINAL_PROGRESS_CLEAR_SEQUENCE  = "\x1b]9;4;0\x07";
```
调用点为 `setProgress(active)`（`terminal.js:418-433`，含 1s 心跳重发）。它不会在终端里弹通知；只是让标签页显示进度指示。

### 2.2 环境变量

【文档证实】`PKG/docs/environment-variables.md` 的「Pi Process Configuration」表格（本机副本 `:79-96`）已通读：`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_PACKAGE_DIR`、`PI_OFFLINE`、`PI_SKIP_VERSION_CHECK`、`PI_TELEMETRY`、`PI_CACHE_RETENTION`、`PI_SHARE_VIEWER_URL`、`PI_RADIUS_GATEWAY`、`PI_HARDWARE_CURSOR`(`:90`)、`PI_HYPERLINKS`(`:91`)、`PI_IMAGE_PROTOCOL`、`PI_TRUE_COLOR`、`PI_TUI_ESC_TIMEOUT`、`VISUAL`/`EDITOR`、`HTTP_PROXY`/`HTTPS_PROXY`。
**没有**任何通知/响铃/完成提示开关。额外的 `WT_SESSION`、`KITTY_WINDOW_ID` 等只被**示例扩展**用来做终端嗅探（见 6.3），不是 Pi 的功能。

补充：`docs/tui.md` 末尾提到调试用 `PI_TUI_WRITE_LOG`（"Use `PI_TUI_WRITE_LOG` to capture the raw ANSI stream when diagnosing rendering problems"）【文档证实】——它是转义序列的**调试记录**开关，不是通知开关。

### 2.3 CLI

【文档证实】`PKG/docs/cli.md` 全文（本机副本 268 行）已通读：各节为 Invocation and output、Models、Sessions、Tools、Resources、Prompts and process、Package commands、Credential commands。**没有任何** notification / bell / sound / OSC 相关参数。

### 2.4 运行时行为：核心是否在 agent 结束或等待用户时主动通知/响铃

- **无 BEL**：【在线源码证实】对 GitHub `main` 的 `packages/coding-agent/src/modes/interactive/interactive-mode.ts`（整文件 239,789 字符 / 6,852 行）做文本检索，`bell` 与 `\u0007` **零匹配**；对 `main` 的 `packages/coding-agent/CHANGELOG.md`（575,811 字符）检索，`bell` 同样**零匹配**（即历史上从未有过 bell 相关条目）。【源码推断】结合 1.1 的实现路径，可判定 TUI 在 agent 结束、等待用户、出错时都**不响铃**。
- **只有 OSC 9;4 进度与 OSC 0 标题**：【在线源码证实】同一文件里 `setProgress` 的调用点是（`this.settingsManager.getShowTerminalProgress()` 为真时）：
  - `turn_start` → `this.ui.terminal.setProgress(true)`；
  - `agent_end` → `setProgress(false)`；
  - `compaction_start` → `true`；`compaction_end` → `false`；
  - `stop()`（退出）→ `false`；切换 TUI 模式时若仍在 streaming/compacting 会 `restoreProgress` → `true`。
- **没有任何 OSC 9 / OSC 777 / OSC 99 通知序列**：本机 `PKG/dist` 非 bundle 产物的检索（前置子代理执行，我在本报告中复核了它的部分行号与 pi-tui 侧全量接口）显示 `\x1b]9`（除 `9;4`）、`\x1b]777`、`\x1b]99` 均无命中；本次我独立通读了 `TUI/dist/terminal.d.ts`（`Terminal` 接口全量，无通知方法）与在线 `packages/tui/src/terminal.ts`（检索 `bell` / `notif` 零匹配）【源码证实 + 在线源码证实】。
- **核心唯一的「通知」字样**是终端**内**文本：`showNewVersionNotification()`（`interactive-mode.js:3675` 起，往 chatContainer 加 "New version X is available…" 文本）【源码证实】；以及崩溃提示、缓存未命中提示等，全部是 TUI 内文本。
- **等待用户时**：核心不通知外部（这与前置调研一致：`ui_prompt_start` 是**给集成方**的事件，Pi 自身不会因此响铃或弹通知）。

### 2.5 结论

【文档证实 + 源码证实】**Pi 核心自身没有「通知用户」功能**：没有桌面通知、没有终端通知序列、没有响铃，只有 OSC 9;4 进度（默认关闭）和 OSC 0 标题两个被 `terminal.*` 管理的显示能力。

---

## 3. 子问题 3：扩展能否写任意终端转义序列

### 3.1 `@earendil-works/pi-tui` 的公开导出里有什么

【源码证实】`TUI/dist/index.d.ts`（整文件通读）导出的与转义序列相关的条目：

| 导出 | 用途 | 与通知的关系 |
|---|---|---|
| `ProcessTerminal`, `type Terminal` | 终端抽象（`start/stop/write/setTitle/setProgress/...`） | **`write()` 是通用原始写入**（见 3.2） |
| `hyperlink`, `detectCapabilities`, `encodeKitty`, `encodeITerm2`, `renderImage`, `imageFallback`, `getCapabilities`, `setCapabilityOverrides`… | OSC 8 超链接、内联图片协议 | 与通知无关 |
| `stripTerminalSequences`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`, `sliceByColumn`, `getOsc8LinkAtColumn` | 宽度/转义处理工具 | 与通知无关 |
| `TuiAltScreen`, `TuiMainScreen`, `TUI`, `Component`, `CURSOR_MARKER`, `compositeTuiLine`… | 渲染框架 | `TUI.terminal` 暴露终端（关键） |
| `parseOsc11BackgroundColor`, `parseTerminalColorSchemeReport` | 解析终端回复 | 与通知无关 |

**没有任何** `notify()` / `bell()` / `osc9()` / `osc777()` / `notification` 形式的导出【源码证实，整文件通读】。

### 3.2 `Terminal` 接口的全部「写」原语

【源码证实】`TUI/dist/terminal.d.ts`（整文件通读，`interface Terminal`）：

```ts
write(data: string): void;      // 任意字节直写 stdout
moveBy / hideCursor / showCursor / clearLine / clearFromCursor / clearScreen
setTitle(title: string): void;  // OSC 0
setProgress(active: boolean): void; // OSC 9;4（进度，非通知）
```

- `ProcessTerminal.write` 的实现是 `process.stdout.write(data)`（`TUI/dist/terminal.js:371-372`，另可选追加 `PI_TUI_WRITE_LOG` 日志，`:373-380`）【源码证实】。
- `Terminal` 内的 OSC 写点只有两处：`setTitle` → `\x1b]0;${title}\x07`（`:414-417`）、`setProgress` → OSC 9;4（`:418-433`）【源码证实】。
- 【在线源码证实】`packages/tui/src/tui.ts`（main）里还有框架内部用 `this.terminal.write(...)` 写的序列：`\x1b[?2031h/l`（终端颜色方案通知）、`\x1b[16t`（查询字符单元尺寸）、`\x1b]11;?\x07`（查询默认背景色）——即 `terminal.write` 就是库内部的通用写通道，**不是为通知设计的**。

### 3.3 扩展怎样才能拿到 `TUI` 实例（关键）

【源码证实】`TUI/dist/tui.d.ts`：`interface TUI extends Component { … terminal: Terminal; … }` —— `terminal` 是**公开字段**。

【源码证实】Pi 把真实 TUI 实例交给扩展的工厂函数：

| 扩展 API | 工厂签名（`ExtensionUIContext`） | Pi 侧证据 |
|---|---|---|
| `ctx.ui.custom(factory)` | `(tui: TUI, theme, keybindings, done) => Component` | `types.d.ts:117-118`（读原文） |
| `ctx.ui.setEditorComponent(factory)` | `(tui: TUI, theme, keybindings) => EditorComponent` | `interactive-mode.js:2163 factory(this.ui, getEditorTheme(), this.keybindings)` |
| `ctx.ui.setWidget(key, (tui, theme) => Component)` | 同上形态 | `types.d.ts` 的 `setWidget` 重载 + `docs/extensions.md`/`docs/tui.md` 的组件工厂说明 |
| `ctx.ui.setFooter(factory)` / `setHeader(factory)` | `(tui: TUI, theme, footerData?) => Component` | `interactive-mode.js:1994-1995` 转发；`types.d.ts:108-114` |
| `onTerminalInput(handler)` | 只监听输入，不给终端对象 | `types.d.ts:79` |

其中 `this.ui` 就是 `InteractiveMode` 的渲染器（`private renderer: TuiMainScreen \| TuiAltScreen`、`private ui: TUI = createInteractiveTuiReference(...)`，**【在线源码证实】** `interactive-mode.ts`），Pi 自己就用 `this.ui.terminal.setTitle(...)` 实现 `ctx.ui.setTitle`（`interactive-mode.js:1996`）。

**由此得出**：
```ts
// 形式上的最小可用调用（TUI 模式）
pi.on("agent_settled", () => { /* 需要一个已挂载的组件工厂才能拿到 tui */ });
ctx.ui.setFooter((tui) => {
  tui.terminal.write("\x1b]777;notify;Pi;Waiting for you\x07"); // OSC 777
  return myFooterComponent;
});
```
【源码推断】这条路径的限制：(1) 必须先通过 `custom/setWidget/setFooter/setHeader/setEditorComponent` 挂载一个组件，才能拿到 `tui`——事件 handler 本身不注入 `tui`；(2) `ctx.ui.custom` 在 RPC 模式返回 `undefined`、`setFooter/setHeader/setEditorComponent` 在 RPC 模式是 no-op（【文档证实】`docs/rpc-extension-ui.md` 限制清单），所以它天然只在 `tui` 模式可用；(3) `terminal.write` 与 `process.stdout.write` 的**字节落点完全相同**，因此并不解决「与差量渲染管线竞争」的问题，只解决「是否有公开入口」的问题。

### 3.4 `terminal.showTerminalProgress` 对应的能力是否对扩展开放

- **不通过 `ExtensionUIContext` 开放**：完整读过 `ExtensionUIContext`（`types.d.ts:69` 起，含全部成员），没有 `setProgress` / `setWorkingProgress` 之类【源码证实】。
- **可以间接调用**：拿到 `tui` 后 `tui.terminal.setProgress(true)` 是公开方法【源码证实】；但进度状态由核心按 `showTerminalProgress` 设置自行增删（`turn_start`/`agent_end`/`compaction_*`/`stop`），扩展自己点亮会与核心状态打架（谁后写谁生效），而且它**不是通知**，对「用户不在看终端」没有帮助【源码推断】。

### 3.5 结论

- **“pi-tui 公开导出里有写 OSC / 通知 / bell 的原语”** → **没有**（只有 OSC 0 标题、OSC 9;4 进度、通用 `write`）。
- **“Pi 暴露给扩展的、会写 OSC 的 API”** → 文档层面只有 `ctx.ui.setTitle`（OSC 0）【文档证实】；类型层面还有 `tui.terminal.write` / `tui.terminal.setProgress`（未文档化的公开类型成员）【源码证实 + 源码推断】。
- **“它们能否用于通知”** → `setTitle` 只能改标题（可作弱信号，不弹系统通知）；`terminal.write` 可以写 OSC 9/777/99，**这就是唯一的「扩展侧终端通知」手段**，且它等于直写 stdout。

---

## 4. 子问题 4：RPC 协议里除 `notify` 外是否有专门的「原生通知」方法

**没有。**

- **客户端 → Pi 的命令集**（穷举）：【源码证实】`PKG/dist/modes/rpc/rpc-types.d.ts` 的 `RpcCommand` 联合（整文件通读）为 `prompt`、`steer`、`follow_up`、`abort`、`clear_queue`、`new_session`、`get_state`、`set_model`、`cycle_model`、`get_available_models`、`set_thinking_level`、`cycle_thinking_level`、`get_available_thinking_levels`、`set_steering_mode`、`set_follow_up_mode`、`compact`、`set_auto_compaction`、`set_auto_retry`、`abort_retry`、`bash`、`abort_bash`、`get_session_stats`、`export_html`、`switch_session`、`fork`、`clone`、`get_fork_messages`、`get_entries`、`get_tree`、`get_last_assistant_text`、`set_session_name`、`get_messages`、`get_commands`。【文档证实】同一枚举在线上 `docs/rpc-commands.md`（整文件通读）逐节列出，**无** notification / notify / desktop 类命令。
- **Pi → 客户端的记录族**：【文档证实】`docs/rpc.md`（本机副本共 191 行，`:31-38` 记录族表）只有四类：stdin `Command`、stdout `response`、stdout `Session event`、双向 `Extension UI record`。其中只有 `Extension UI record` 携带 `notify`。
- **`RpcExtensionUIRequest` 的方法全集**：【源码证实】`select`、`confirm`、`input`、`editor`、`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text` —— **没有** `notification` / `desktopNotification` / `bell`。
- **扩展能否通过公开 API（而非自己 `spawn`）让宿主弹系统通知**：只能发 `notify`（fire-and-forget JSON）然后**寄希望于宿主**。协议本身没有任何「原生通知」语义，Pi 也不提供会这样做的官方客户端（1.2 已证）【文档证实 + 源码证实】。

---

## 5. 子问题 5：版本差异（0.87.0 → 0.87.1，及 0.87.x）

【源码证实】本机 `PKG/CHANGELOG.md`：

- `## [0.87.1] - 2026-09-22`（`:3`）：New Features（最新前沿模型、xAI 默认 Grok 4.7）、Added（Copilot/OpenAI/Anthropic 模型支持）、Changed（xAI 默认模型）、Fixed（compaction 摘要、`--mode` 校验、图片消息、Anthropic OAuth 版本头）。**没有任何** notification / OSC / bell / terminal 相关条目。
- `## [0.87.0] - 2026-09-21`（约 `:28`）：Canonical session context / `context_with_system` / per-model image limits；Breaking（`shouldStopAfterTurn`、`ContextEditEntry`、`SessionManager`、`TurnEndEvent`、`agent_settled` 派发时机）；Added（context edits、`turn_end`/`agent_before_settle`、retain-none compaction、`context_with_system`、`inputLimits.images.resize`）；Fixed 若干。**同样没有** notification / OSC / bell / terminal 条目。
- 【在线源码证实】`main` 的 `CHANGELOG.md`（575,811 字符）全文检索 `bell` → **零匹配**；`desktop notification` → 只命中一条**早期**条目："Extension example: `notify.ts` for desktop notifications via OSC 777 escape sequence ([#658](https://github.com/badlogic/pi-mono/pull/658) by [@ferologics](https://github.com/ferologics))"。
- 首个 OSC 相关条目出现在 **0.86.1**（`PKG/CHANGELOG.md` 同段）："Fixed clipboard copy failing in containers and WSL without WSLg by restoring the **OSC 52** fallback …"，与通知无关。
- 版本时效性核对【在线源码证实】：npm registry `@earendil-works/pi-coding-agent/latest` 返回 `"version":"0.87.1"`，与本机一致——即本报告结论**对当前最新发布版成立**。

---

## 6. 子问题 6：上游意图（GitHub issues / PRs）

检索方式：GitHub 搜索 API（`repo:earendil-works/pi`，`in:title` 与全文）+ 逐条打开原始页面。

| # | 类型 | 标题 | 状态 | 与本问题的关系 | URL |
|---|---|---|---|---|---|
| [#462](https://github.com/earendil-works/pi/pull/462) | PR | `Add bell() method to HookUIContext for terminal notifications` | **CLOSED（abandoned）** 2026-01-05，+55/−7，10 文件 | 提议给扩展 UI 上下文加 `bell()`（TUI 写 `\x07`，RPC 发 `hook_ui_request`，headless no-op），并附 `examples/extensions/bell.ts`。维护者 badlogic 回复：**"This is a cool idea, but I'd rather have this as a simple extension."** 提案者随后说 "i dont think its currently possible as an extension, as extensions dont have access to the `terminal` to send the bell escape codes" | [PR](https://github.com/earendil-works/pi/pull/462) |
| [#658](https://github.com/earendil-works/pi/pull/658) | PR | `example: add desktop notification extension (OSC 777)` | **MERGED** 2026-01-12，+25/−0，1 文件 | 官方示例 `examples/extensions/notify.ts` 的来源。描述：**"Uses OSC 777 escape sequence - no external dependencies."** 支持 Ghostty/iTerm2/WezTerm/rxvt-unicode；明确**不支持** Kitty（用 OSC 99）、Terminal.app、Windows Terminal、Alacritty。维护者合并并补了 changelog/README。→ 上游选择「示例扩展」而非核心 API | [PR](https://github.com/earendil-works/pi/pull/658) |
| [#5788](https://github.com/earendil-works/pi/issues/5788) | issue | `feat: Add notification on agent_end` | **CLOSED (NOT_PLANNED)** 2026-06-16，label `no-action`，机器人自动关闭，无维护者回复 | 请求「agent 结束时通知」，正文明确列出 "System notification (OS-level) vs in-TUI notification — open to discussion"、"Bell character (`\a`) as a lightweight alternative?"、"Could be a setting (opt-in or opt-out)"。**提出但未被采纳** | [issue](https://github.com/earendil-works/pi/issues/5788) |
| [#7967](https://github.com/earendil-works/pi/pull/7967) | PR | `feat(coding-agent): add VS Code support to notify example` | CLOSED（abandoned，机器人自动关闭）2026-08-11，+2/−2 | 给示例 `notify.ts` 增加 `TERM_PROGRAM === "vscode"` → 走 OSC 99 分支；描述称 "VS Code renders OSC 99 sequences as desktop notifications"。**未被合并**（贡献者政策），但说明社区在 OSC 通道上继续加终端覆盖 | [PR](https://github.com/earendil-works/pi/pull/7967) |
| [#8264](https://github.com/earendil-works/pi/issues/8264) | issue | `Kitty terminal sends repeated notifications during Pi agent runs` | CLOSED（NOT_PLANNED，label `bug`+`no-action`）2026-08-17，报告版本 0.84.1 | **在 Kitty 开启 `notify_on_cmd_finish unfocused` 时，Pi 每个 assistant 响应都会触发一次系统通知**，推测与 Pi 输出中的 **OSC 133**（shell integration 标记）有关。→ 说明「Pi 的输出会被终端解释成通知」这件事上游知道但拒绝修（NO-ACTION），也说明 OSC 通道的**噪声**问题真实存在 | [issue](https://github.com/earendil-works/pi/issues/8264) |
| [#8670](https://github.com/earendil-works/pi/issues/8670) | issue | `Host UIs cannot distinguish background/worker sessions from interactive sessions, so unread/notification state cannot be managed correctly` | CLOSED (NOT_PLANNED) 2026-08-26，`no-action` | 宿主 UI（桌面应用）侧「未读/通知状态」无法管理：请求 session 上暴露 `kind`/`mode`（interactive vs background）。→ 与「宿主自弹通知」相关，但被拒 | [issue](https://github.com/earendil-works/pi/issues/8670) |
| [#9939](https://github.com/earendil-works/pi/issues/9939) | issue | `Update banners repeat on every launch — notify once per release, or add a settings toggle` | CLOSED（untriaged 自动关闭）2026-09-23 | 「更新横幅通知」的降噪请求，与投递通道无关（仅作检索覆盖度证据） | [issue](https://github.com/earendil-works/pi/issues/9939) |

检索覆盖度（搜索 API 的 `total_count`，本次运行日快照）：`notification in:title` = 11 条、`notify in:title` = 18 条、`OSC in:title` = 35 条（绝大多数是 OSC 8/11/52 等渲染话题）、全文 `"desktop notification"` = **4** 条（即上表的 #8264 / #7967 / #658 / #462——**已全部读过**）。

**上游意图结论（【在线源码证实】）**：
- **已实现**：`examples/extensions/notify.ts`（OSC 777 / OSC 99 / PowerShell toast，挂在 `agent_settled`）——但它是**示例代码**，不是核心 API。
- **已提案未采纳**：核心/扩展 API 层的通知原语（`bell()` PR #462、`agent_end` 通知 issue #5788、宿主 session kind #8670）。
- **不存在**：桌面通知 API、终端通知 API、响铃 API。

### 6.3 官方示例的实现细节（0.87.1 与 0.84.2 对照）

【源码证实】`PKG/examples/extensions/notify.ts`（0.87.1）：

- `notifyOSC777(title, body)` → `process.stdout.write(`\x1b]777;notify;${title};${body}\x07`)`
- `notifyOSC99(title, body)` → 两段 `process.stdout.write("\x1b]99;i=1:d=0;…")` / `"\x1b]99;i=1:p=body;…"`
- `notifyWindows(title, body)` → `execFile("powershell.exe", ["-NoProfile", "-Command", <WinRT Toast 脚本>])`（**把 body 直接插值进 PowerShell 字符串**——对 pi-guard 而言是反面教材）
- 分发：`process.env.WT_SESSION` → Windows toast；`process.env.KITTY_WINDOW_ID` → OSC 99；否则 → OSC 777
- 触发：`pi.on("agent_settled", …)`，注释原文："`agent_end` fires after each low-level run; Pi may still retry, compact, or continue with queued follow-ups. Notify only after the full run settles."
- `PKG/examples/extensions/README.md` 描述："`notify.ts` | Desktop notifications via OSC 777 when agent finishes (Ghostty, iTerm2, WezTerm)"

【源码证实】`plugins/pi-guard/node_modules/@earendil-works/pi-coding-agent/examples/extensions/notify.ts`（**0.84.2**，pi-guard 的 devDependency 版本）：同样的 OSC 777 / OSC 99 / toast 实现，唯一差别是**挂在 `agent_end`**（0.87.1 已改为 `agent_settled`）。→ 这条「插件直写 OSC」的示例在 0.84.2 就已存在。

---

## 7. 三类通道逐条判定

| 通道 | Pi 侧公开 API | 核心是否自己用 | 触达范围（用户不在看终端时） | 失败反馈 | 证据 |
|---|---|---|---|---|---|
| (a) OS 桌面通知 | **无** | 无 | 需扩展自行 spawn（`notify-send`/`osascript`/`terminal-notifier`/PowerShell toast）；只有官方示例的 Windows toast 分支 | 取决于外部程序 | `docs/settings.md:86-92`、`docs/environment-variables.md:79-96`、`docs/cli.md` 全文、`types.d.ts:69-192`（无 API）；`examples/extensions/notify.ts`（toast 分支） |
| (b) 终端 OSC 通知（9/777/99） | **无专用 API**；有 `tui.terminal.write()` 公开类型入口（未文档化）；`ctx.ui.setTitle`（OSC 0） | **无**（核心只写 OSC 0 标题、OSC 9;4 进度、OSC 8 超链接） | 需扩展自己写字节；终端支持与否不确定 | 无（fire-and-forget） | `TUI/dist/terminal.d.ts`、`TUI/dist/terminal.js:371-372/414-433`、`TUI/dist/tui.d.ts`、`interactive-mode.js:1996/2163`、`docs/tui.md` 全文、`examples/extensions/notify.ts`、PR #658/#7967、issue #8264 |
| (c) RPC 转发宿主 | 只有 `notify`（fire-and-forget 事件） | 无客户端会弹系统通知 | 取决于宿主实现；官方示例客户端只打印文本 | 无（协议不要求响应） | `docs/rpc-extension-ui.md`、`docs/rpc.md:31-38`、`rpc-types.d.ts`、`examples/rpc-extension-ui.ts` |

---

## 8. 为找它而检索过的位置（证明是穷举，而非「没找到」）

**本机 Pi 0.87.1 包（主源）**

1. `dist/core/extensions/types.d.ts`：`ExtensionUIContext` 全接口（`:69` 起至接口结束）逐成员读过 → 无通知/响铃/转义 API；`notify` 在 `:77`，`setTitle` 在 `:116`，组件工厂签名 `:108-118`。
2. `dist/core/extensions/runner.js`：`noOpUIContext`（`:130-161`，`notify: () => { }` 在 `:136`）、`setUIContext`（`:315`）、`wrapUIPromptContext`（`:318-327`）、`ctx.ui` getter。
3. `dist/modes/interactive/interactive-mode.js`：`createExtensionUIContext`（`:1976-2006`）、`notify` 转发（`:1981`）、`setTitle`（`:1996`）、`showExtensionNotify`（`:2225-2235`）、`showStatus`（`:2998-3012`）、`showError`（`:3666-3670`）、`showWarning`（`:3671-3675`）、`setCustomEditorComponent`（`:2155-2163`，证明工厂收到 `this.ui`）。
4. `dist/modes/rpc/rpc-types.d.ts`：`RpcCommand`（客户端→Pi 全命令集）、`RpcResponse`、`RpcExtensionUIRequest`（含 `notify`）、`RpcExtensionUIResponse` 全量通读。
5. `dist/modes/print-mode.js`：`:54-55` 的 `bindExtensions` 无 `uiContext`。
6. `docs/settings.md`（150 行全文）、`docs/environment-variables.md`（`:79-96` Pi 进程配置全表）、`docs/cli.md`（268 行全文）、`docs/rpc.md`（记录族表与生命周期）、`docs/rpc-extension-ui.md`（全文）、`docs/tui.md`（全文）、`docs/terminal-setup.md`（219 行全文，含 `:219` 的 "Unsupported escape sequences can corrupt rendering"）、`docs/extensions.md`（模式表与 UI 章节，经线上同源文档核对）、`CHANGELOG.md`（`:1-90`，覆盖 0.87.1/0.87.0/0.86.1）。
7. `examples/extensions/notify.ts`、`examples/extensions/README.md`、`examples/rpc-extension-ui.ts`。
8. `PKG/package.json` 版本、安装路径版本、npm registry `latest`。

**`@earendil-works/pi-tui`（0.87.1）**

9. `dist/index.d.ts`（导出清单全文）、`dist/terminal.d.ts`（`Terminal`/`ProcessTerminal` 全文）、`dist/tui.d.ts`（`TUI`/`TuiBase` 全文）、`dist/terminal.js`（全部转义序列写入点与常量）；线上 `src/terminal.ts`、`src/tui.ts`（main）全文文本检索 `bell`/`notif`。

**排除项（不视为 API 面）**：`dist/bundle/*.js`（与 `dist/**` 同源，行号不可用）、`dist/**/*.js.map`。

**未做的事（诚实声明）**：本子代理**没有** `bash`/`grep` 工具，无法对全部 `dist/**`（数千文件）做一次全量 grep。因此「核心所有模块里都没有 BEL/OSC 通知写入」这一条是**范围受限的**结论：证据为 ①对 `PRIMARY` 渲染路径（interactive-mode）的**整文件**在线文本检索（`bell`/`\u0007` 零匹配）、②对 pi-tui 全接口与实现的通读、③前置子代理在本地 `dist`（非 bundle）上的 grep（`\x1b]9` / `\x1b]777` / `\x1b]99` / `\x07` 无命中；我未能对第 ③ 条做全量复算（只复核了它引用的行号）。

**仓库外检索**

10. GitHub 搜索 API：`repo:earendil-works/pi` + `notification in:title`（11）、`notify in:title`（18）、`OSC in:title`（35）、全文 `"desktop notification"`（4，全部打开读过）。
11. 逐个打开：#462、#658、#5788、#7967、#8264、#8670、#9939；线上 `main` 的 `docs/extensions.md`、`docs/rpc-commands.md`（854 行全文）、`packages/coding-agent/CHANGELOG.md`、`packages/coding-agent/src/modes/interactive/interactive-mode.ts`、`packages/coding-agent/examples/rpc-extension-ui.ts`、`packages/tui/src/{terminal,tui}.ts`。
12. `source_check`：对「扩展可通过 `tui.terminal.write()` 写转义序列」这一判断做了一次外部来源校验，返回 **status: unclear（confidence 0.30）**，未产出支持或反驳的逐passage证据（详见第 9 节）。

---

## 9. 矛盾与冲突

1. **「Pi 没有写转义序列的公开 API」（前置报告，0.84.2）vs 本次实测（0.87.1）**：`TUI.terminal.write()` 是公开类型成员，且 Pi 把 TUI 实例交给扩展工厂。**本报告以本机源码为准**：在 `ExtensionUIContext` 层面旧结论成立，在 pi-tui/TUI 层面旧结论不成立。同时注意 `docs/tui.md` 明确写了 "Do not create a second terminal renderer inside an extension."，而 `terminal.write` 未被文档记录——**这是「类型公开」与「文档承诺」之间的真实冲突，本报告不做统一**，只标注为「无稳定承诺的灰区」。
2. **维护者的立场内部也有张力**：PR #462 中维护者说 "I'd rather have this as a simple extension"（通知应由扩展做），但提案者指出扩展拿不到 `terminal`（当时正确）。半年后的今天，扩展**可以**通过 `ctx.ui` 组件工厂拿到 TUI——即「做成扩展」在技术上比维护者当时假设的更可行，但上游从未把这条路径写进文档。
3. **上游示例 vs 上游对 OSC 噪声的处理**：`notify.ts`（合并）鼓励写 OSC 通知，而 issue #8264（Kitty 因 Pi 输出的 OSC 133 反复弹通知）被判 NO-ACTION。两者并不直接矛盾，但说明**上游不会为「终端把 Pi 的输出解释成通知」承担行为保证**。
4. **`ctx.hasUI` 的语义易被误解**：RPC 模式 `hasUI === true`（文档明示），因此 `hasUI` **不能**当作「用户真的在看终端」；`ctx.mode === "tui"` 才是。这与「通知是否需要系统通道」的判断直接相关。
5. **第三方生态的描述与事实冲突**：VS Code 扩展市场的 `pi-vscode-terminal-notify` 页面文案称 "**The Pi Coding Agent** uses OSC 9 notification terminal escape sequences for macOS notifications"——这句把**扩展自己**的行为说成了 Pi 的行为（实际 Pi 核心不写 OSC 9 通知，且该扩展在 PR #7967 里走的是 **OSC 99** 分支）【二手来源，低置信，仅作对照】。本机源码不支持该文案。

---

## 10. 缺失证据与未证实项

| # | 未证实内容 | 影响 | 验证方法 |
|---|---|---|---|
| 1 | 除 interactive-mode 与 pi-tui 之外，`dist/**` 全部模块中**是否**还有其他 BEL/OSC 通知写入 | 「核心不响铃/不写 OSC 通知」的穷举强度 | 在有 shell 的环境执行 `grep -rn -e $'\x07' -e 'x1b]9' -e 'x1b]777' -e 'x1b]99' "$PKG/dist" --include='*.js' \| grep -v /bundle/` |
| 2 | 第三方 Pi 包（pi-notify、pi-chime、@jmcombs/pi-notify、guardrails-notify、pi-vscode-terminal-notify…）各自的投递实现与实测触达率 | 若 pi-guard 想引用现成方案 | 逐个读包源码 + 真实终端实测；本轮只确认它们**存在**（二手来源） |
| 3 | `tui.terminal.write()` 在差量渲染/`CSI 2026` 原子帧下是否会撕裂画面 | 决定 OSC 通道是否可用于安全插件 | 真机实测：在 `setFooter` 工厂里高频写 OSC 与可见文本，配合 `PI_TUI_WRITE_LOG` 抓原始字节流；或写最小复现扩展 |
| 4 | macOS/`osascript` 与 Script Editor 授权归属、`terminal-notifier` 的 argv 校验等（前置报告已列） | 影响 spawn 链的可靠性 | 属前置报告范围，本轮未复核 |
| 5 | `source_check` 未能确认「扩展可通过 `tui.terminal.write()` 写转义序列」 | 该判断仅有本机源码 + 在线源码支持，无第三方佐证 | 以本机为权威源已足够（项目约定：本机公开 API 优先）；如需外部佐证，可在官方文档/issue 中要求明确 `TUI.terminal` 的支持级别 |
| 6 | `PKG/docs/rpc.md` 第 121-191 行（framing/errors/shutdown/minimal client）未逐行读 | 影响面极小（记录族已在 `:31-38` 穷举，且与 `rpc-types.d.ts` 一致） | 通读剩余部分 |
| 7 | 线上 `main` 与 0.87.1 的漂移程度（本报告部分结论基于 `main` 源码做整文件检索） | 「无 bell」结论的版本精度 | 对 0.87.1 tag 的 `packages/coding-agent` 源码重复同样检索；或直接用 `grep` 覆盖本机 `dist`（见 #1） |

---

## 11. 对 pi-guard 的含义

**先说结论**：三类通道**都没有**由 Pi 保证的投递路径，因此**现有「spawn 独立系统通知进程」的降级链仍然必要**——它是唯一同时具备「真正触达用户」+「失败可探测」+「不污染 stdout 数据通道」的手段。OSC 通道（含 `tui.terminal.write`）只能作为**可选的、零依赖的前置层**，不能替代系统通知。

可供选择的改进方向（只列选项与代价，不代替决策）：

1. **维持现状：spawn 系统通知进程（macOS: terminal-notifier→osascript；Linux: notify-send→gdbus；Windows: 默认不 toast）**
   - 收益：触达最可靠；退出码/ENOENT 可判断失败并降级；不写终端字节，绝不干扰 TUI 与 `print/json/rpc` 数据通道。
   - 代价：需要外部程序或权限（macOS 自动化授权 / Script Editor 归属问题；Linux `notify-send` 常需手装）；Windows toast 有 EDR 误报风险（前置报告已记录）；需要自己实现超时、去重、节流。
2. **增加一条 OSC 前置层（照官方 `notify.ts` 的分发逻辑：`WT_SESSION`→toast / `KITTY_WINDOW_ID`→OSC 99 / 否则 OSC 777）**
   - 收益：零依赖、零权限；在支持的终端上（Ghostty/iTerm2/WezTerm/VS Code 终端等）用户切走后能看到桌面通知；与上游示例保持一致，行为可被用户预期。
   - 代价：
     - **只在 `ctx.mode === "tui"` 有意义**，必须显式短路 `rpc/json/print`（否则污染 stdout 数据通道）；
     - **fire-and-forget，无失败反馈**，不能作为唯一通道（终端不支持时静默丢弃：Terminal.app、Alacritty、Windows Terminal 旧版；tmux 需 `allow-passthrough`）；
     - 写出的是裸字节，官方示例也是直写 `process.stdout`，与差量渲染竞争的风险由插件自担（`docs/terminal-setup.md:219` 明确提醒不支持的序列可能破坏渲染）；
     - 终端自身可能已在该通道上产生噪声（issue #8264 的同类现象），叠加插件通知会更吵；
     - 官方示例的 Windows 分支把文本插值进 PowerShell 字符串，**pi-guard 不应照抄**（安全插件不能自带注入面）。
3. **用 `tui.terminal.write()` 而不是 `process.stdout.write()`（需要先通过 `ctx.ui.setFooter/setWidget/custom` 挂载组件拿到 `tui`）**
   - 收益：入口是公开类型成员；可与组件的生命周期绑定（例如只在有 UI 时写）。
   - 代价：组件挂载/卸载状态机是新的复杂度与泄漏面（`setWidget`/`setFooter` 需要注销、`/reload` 会重建扩展运行时）；字节落点与直写 stdout **完全相同**，**并不解决**与渲染管线竞争的问题；`Terminal.write` 未被文档承诺为扩展 API，未来版本可能不被视为兼容面。
4. **把 RPC 场景交给宿主**（宿主监听 `ui_prompt_start` 或 `notify`，由宿主弹系统通知）
   - 收益：语义最干净（Pi 只声明「我在等人」，投递方式由宿主决定）；pi-guard 不需要新依赖。
   - 代价：依赖宿主实现，pi-guard 无法保证；`ctx.mode === "rpc"` 时用户可能根本没有「桌面」（IDE/服务端宿主）。
5. **向上游提案（例如 `ctx.ui.notify` 增加 OS-level 后端，或像 Claude Code 的 `terminalSequence` 白名单让宿主代写 OSC）**
   - 收益：从根上解决（宿主代写、race-free、可跨 tmux/screen/Windows）。
   - 代价：不可控时间线；上游历史显示同类提案（#462 `bell()`、#5788 通知）均被拒或未处理，成功概率低。
6. **可组合的默认策略（不改动现有架构的前提下）**
   - 若采纳 OSC 前置层：`tui` 模式且 `showTerminalProgress` 无关；**必须先判定终端能力**（存在 `WT_SESSION`/`KITTY_WINDOW_ID`/`TERM_PROGRAM`，或对 OSC 支持白名单），否则直接跳过；然后**仍然**执行系统通知链（去重后只发一次），让 OSC 只是「更早被看见」的补充。
   - 与 `ui_prompt_start`（另一份前置调研的结论）的关系：**「何时通知」用 `ui_prompt_start`，「如何投递」仍是本报告的结论——没有 Pi 侧通道，只能 spawn 或自写 OSC。** 两者正交，不冲突。

---

## 12. 来源清单

**保留（主源，决定结论）**

- `PKG/dist/modes/interactive/interactive-mode.js`（`:1976-2006`、`:2225-2235`、`:2998-3012`、`:3666-3675`、`:2163`）——`notify` 全链路与工厂注入 TUI
- `PKG/dist/core/extensions/types.d.ts`（`:69` 起、`:77`、`:108-118`）——`ExtensionUIContext` 全接口、`notify`、`setTitle`、工厂签名
- `PKG/dist/core/extensions/runner.js`（`:130-161`、`:136`、`:315`）——`noOpUIContext`（print/json 静默的决定性证据）
- `PKG/dist/modes/print-mode.js:54-55`——print/json 不传 `uiContext`
- `PKG/dist/modes/rpc/rpc-types.d.ts`——RPC 双向记录全集（证明无原生通知方法）
- `TUI/dist/index.d.ts`、`dist/terminal.d.ts`、`dist/tui.d.ts`、`dist/terminal.js`（`:7-9`、`:371-372`、`:414-433`）——pi-tui 公开导出与全部转义写点
- `PKG/docs/settings.md`（`:86-92`）、`environment-variables.md`（`:79-96`）、`cli.md`、`rpc.md`（`:31-38`）、`rpc-extension-ui.md`、`tui.md`、`terminal-setup.md`（`:219`）、`extensions.md`——官方口径
- `PKG/examples/extensions/notify.ts` 与 `README.md`、`examples/rpc-extension-ui.ts`——上游示例的实际做法
- `PKG/CHANGELOG.md`（`:1-90`）——0.87.0/0.87.1 无通知类条目
- GitHub：[#462](https://github.com/earendil-works/pi/pull/462)、[#658](https://github.com/earendil-works/pi/pull/658)、[#5788](https://github.com/earendil-works/pi/issues/5788)、[#7967](https://github.com/earendil-works/pi/pull/7967)、[#8264](https://github.com/earendil-works/pi/issues/8264)、[#8670](https://github.com/earendil-works/pi/issues/8670)——上游意图
- 线上 `main`：`interactive-mode.ts`（整文件检索 `bell`/`\u0007` 零匹配；`setProgress` 调用点）、`CHANGELOG.md`（`bell` 零匹配）、`docs/rpc-commands.md`（命令集全文）、`packages/tui/src/{terminal,tui}.ts`
- `https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest` → `0.87.1`（时效性锚点）

**降权 / 未采用**

- `dist/bundle/*.js`、`*.js.map`——与 `dist/**` 同源打包产物，行号不可用
- `pi.dev/packages/*`（pi-notify、pi-chime、@jmcombs/pi-notify、@diegopetrucci/pi-notify、@raidou/pi-notify、guardrails-notify、pi-terminal-signals 等）——仅证明「通知由第三方扩展实现」这一生态事实，未逐个读源码，低置信
- Visual Studio Marketplace 的 `pi-vscode-terminal-notify` 页面文案——与上游源码冲突（见 9.5），仅作对照
- `source_check` 的模糊结果（status unclear / 0.30）——未产出可用证据，不作为结论依据
- 各类第三方博客/视频（bitdoze、kostyay、deepakness、YouTube 等）——与结论无关

---

## 附：一句话回答

**Pi 0.87.1 没有「通知投递 API」。** `ctx.ui.notify` 只是终端内文本（TUI）/ fire-and-forget JSON（RPC）/ no-op（print/json）；核心只写 OSC 0 标题与 OSC 9;4 进度，不响铃、不弹桌面通知；RPC 没有原生通知方法，也不自带会弹系统通知的客户端；唯一能触达用户终端之外的做法是**扩展自己 spawn 系统通知进程**（官方示例选了另一条：自己写 OSC 777/99）。

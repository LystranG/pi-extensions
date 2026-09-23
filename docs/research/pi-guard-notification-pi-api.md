# 调研：pi-guard 授权确认框的「等待用户」可观测扩展点

> 调研基线：本机已安装 `@earendil-works/pi-coding-agent@0.87.0`
> 主源根目录（下文所有 `dist/...`、`docs/...`、`CHANGELOG.md` 相对路径均以此为根）：
> `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.0/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.0/node_modules/@earendil-works/pi-coding-agent`
>
> 仓库内被调研对象：`plugins/pi-guard/src/policy.ts`、`plugins/pi-guard/src/index.ts`、`plugins/pi-guard/src/types.ts`
>
> 证据等级标注约定：
> - **【源码证实】** = 直接读到实现/类型/文档原文，附 `文件:行号`
> - **【源码推断】** = 由已读源码与导出清单推导，未逐行读到调用点
> - **【未证实】** = 本轮未取得证据，附验证方法
>
> 行号说明：本机包为 tsc 生成的未打包产物（`dist/**/*.js`，与 `dist/bundle/*.js` 同源），行号通过 `read` 分段定位确认；个别只做过区间估算的位置标注 `≈`。

---

## 摘要

1. **主代理结论 1/2/3 全部成立**：0.87.0 确实存在 `ui_prompt_start` / `ui_prompt_end`，由 `ExtensionRunner.withUIPrompt()` 包裹 `ctx.ui.select/confirm/input/editor/custom` 时发出，用 `uiPromptDepth` 做嵌套合并，经 `queueMicrotask` + `emit` 异步派发且 **handler 不被 await**；pi-guard 自己调用 `ctx.ui.confirm` 会得到 `kind: "confirm"` 的 `ui_prompt_start`。
2. **关键边界**：该事件只覆盖「扩展通过 `ctx.ui` 发起的提示」。Pi 内置对话框（project trust、`/model`、`/resume`、`/settings` 等）走独立 TUI 组件，不经过 `wrapUIPromptContext`，**不产生** `ui_prompt_start`；0.87.0 也**没有内置的工具调用审批对话框**（审批由扩展实现，如官方示例 `permission-gate.ts`）。
3. **版本兼容的硬约束**：这两个事件由 **0.84.4** 引入（`CHANGELOG.md:217`、`:231`，PR [#8355](https://github.com/earendil-works/pi/pull/8355)），而 pi-guard 的 `peerDependencies` 下限是 `>=0.84.2`。但 `pi.on()` 对事件名**不做任何校验**（`loader.js:202-219`），因此注册一个旧版本不存在的监听不会报错，只是永不触发——这使「运行时探测 + 优雅降级」成为可行策略。

---

## 1. 对主代理三条结论的逐条核实

| # | 待核实结论 | 判定 | 证据 |
|---|---|---|---|
| 1 | 0.87.0 存在 `ui_prompt_start` / `ui_prompt_end`，类型在 `types.d.ts` 约 627-640，`on()` 重载存在，文档在 `docs/extensions.md` 约 608-626 | **成立（行号精确）** | `dist/core/extensions/types.d.ts:627`（`UIPromptKind`）、`:629-634`（`UIPromptStartEvent`）、`:636-641`（`UIPromptEndEvent`）；`on()` 重载 `types.d.ts:1002-1003`；文档 `docs/extensions.md:608-626`【源码证实】 |
| 2 | 事件由 `ExtensionRunner.withUIPrompt()` 包裹 `ctx.ui` 的 5 个方法时发出，`uiPromptDepth` 合并嵌套（只发最外层），`queueMicrotask` + `emit` 异步派发，handler 不被 await | **成立，但需两处修正**：① 只有 `select/confirm/input/editor/custom` 被包裹，`notify/setStatus/setWidget/setTitle/setEditorText/...` 是原样透传（`...ui`），**不发事件**；② `custom` 的 `title` 固定为 `undefined` | `dist/core/extensions/runner.js:314-317`（`setUIContext`）、`:318-327`（`wrapUIPromptContext`）、`:328-354`（`withUIPrompt`）、`:355-359`（`emitUIPromptEvent`）；文档同段【源码证实】 |
| 3 | pi-guard 自己调用 `ctx.ui.confirm` 会触发 `ui_prompt_start`（`kind: "confirm"`） | **成立** | `ctx.ui` getter 直接返回 `runner.uiContext`（即被包裹对象）：`runner.js:553-556`；pi-guard 调用点 `plugins/pi-guard/src/policy.ts:38-41`（`ctx.ui.confirm("Confirm dangerous command", ...)`）、`:66`（`ctx.ui.confirm("Confirm PTY input", ...)`）【源码证实】 |

补充：文档原文对语义的权威表述（与本机 `docs/extensions.md:610`、`:612` 一致，且与官网 latest 文档一致）：

> "Notification-only lifecycle events for blocking user-facing **extension** UI prompts. They fire around `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`, and `ctx.ui.custom()` so host/status integrations can report "waiting for user" instead of just "running"."
>
> "Nested or overlapping prompts are coalesced into one outer waiting span. Handlers are invoked best-effort and are **not awaited** before showing or closing the prompt."
>
> 来源：`docs/extensions.md:608-626`；官网 <https://pi.dev/docs/latest/extensions#ui_prompt_start--ui_prompt_end>

---

## A. `ui_prompt_start` / `ui_prompt_end` 的精确语义

核心实现（`dist/core/extensions/runner.js:314-359`，逐字摘录）：

```js
314  setUIContext(uiContext, mode = "print") {
315      this.uiContext = uiContext ? this.wrapUIPromptContext(uiContext) : noOpUIContext;
316      this.mode = mode;
317  }
318  wrapUIPromptContext(ui) {
319      return {
320          ...ui,
321          select: (title, options, opts) => this.withUIPrompt("select", title, () => ui.select(title, options, opts)),
322          confirm: (title, message, opts) => this.withUIPrompt("confirm", title, () => ui.confirm(title, message, opts)),
323          input: (title, placeholder, opts) => this.withUIPrompt("input", title, () => ui.input(title, placeholder, opts)),
324          editor: (title, prefill) => this.withUIPrompt("editor", title, () => ui.editor(title, prefill)),
325          custom: (factory, options) => this.withUIPrompt("custom", undefined, () => ui.custom(factory, options)),
326      };
327  }
328  withUIPrompt(kind, title, run) {
329      const outerPrompt = this.uiPromptDepth++ === 0;
330      if (outerPrompt) {
331          this.activeUIPrompt = { kind, title };
332          this.emitUIPromptEvent({ type: "ui_prompt_start", reason: "ui_prompt", kind, ...(title ? { title } : {}) });
333      }
334      const finish = () => {
335          if (--this.uiPromptDepth > 0) return;
336          this.uiPromptDepth = 0;
337          const prompt = this.activeUIPrompt ?? { kind, title };
338          this.activeUIPrompt = undefined;
339          this.emitUIPromptEvent({ type: "ui_prompt_end", reason: "ui_prompt", kind: prompt.kind, ...(prompt.title ? { title: prompt.title } : {}) });
340      };
341      try {
342          return run().finally(finish);
343      } catch (err) {
344          finish();
345          throw err;
346      }
347  }
348  emitUIPromptEvent(event) {
349      queueMicrotask(() => { void this.emit(event); });
350  }
```
（行号为真实行号：`withUIPrompt` 328-354、`emitUIPromptEvent` 355-359）

### A1. 触发时机：在对话框「创建之前排队」，在「用户可交互之前」执行 handler

**【源码证实】** 顺序是：`uiPromptDepth++` → `emitUIPromptEvent(start)`（`:332`，只把任务塞进 microtask 队列）→ `run()`（`:342`，同步调用真正的 UI 方法，返回 Promise）。因此：

- `ui_prompt_start` 的**排队**发生在对话框被创建之前；
- handler 的**实际执行**发生在当前同步帧结束后的 microtask 中，通常早于 TUI 的下一帧渲染（渲染在宏任务/渲染循环里）；
- `ui_prompt_end` 在 `run()` 返回的 Promise settle 之后由 `.finally(finish)` 触发（`:342`），即对话框关闭/取消/超时/抛出时。

**推论（源码推断）**：`ui_prompt_start` 不等价于「对话框已经画在屏幕上」，而是「Pi 开始阻塞等待该提示」。对系统通知而言这个差别通常无关紧要（用户尚未作答），但不应把该事件当作「画面已就绪」的保证。

### A2. 合并/嵌套规则：按深度计数，只发最外层一次 start / 一次 end

**【源码证实】** `uiPromptDepth` 计数器（`uiPromptDepth = 0` 为类字段，`runner.js` 类字段区，≈190 行）：

- 只有 `this.uiPromptDepth++ === 0` 的那次调用（`outerPrompt`）会发 `ui_prompt_start`（`:329-332`）。
- `finish` 里 `if (--this.uiPromptDepth > 0) return;`（`:335`），只有深度回到 0 时才发 `ui_prompt_end`（`:339`）。
- `ui_prompt_end` 的 `kind`/`title` 取自 `activeUIPrompt`（最外层那次调用的 `kind/title`），不是「最后结束的那次」。
- 同一扩展并发调用两次 `ctx.ui.confirm`（例如 `Promise.all`）→ 只产生一个等待窗口。

### A3. handler 是否被 await：不被 await（但 `emit` 内部串行 await 各 handler）

**【源码证实】** `emitUIPromptEvent` 是 `queueMicrotask(() => { void this.emit(event); })`（`:355-359`）——返回的 Promise 被 `void` 丢弃，调用方（`withUIPrompt`）不等待。`emit` 内部则逐个 `await handler(event, ctx)`（`runner.js:717-744`，`await` 在 `:723`）。结论：**handler 的耗时不会延迟对话框显示，也不会延迟对话框关闭**；但同一事件的多个 handler 之间是串行的。

### A4. handler 抛错 / 耗时长 / 永不 resolve 的后果

**【源码证实】** `emit` 对每个 handler 都有 `try/catch`（`runner.js:722`/`731`），异常被收集并通过 `this.emitError({extensionPath, event, error, stack})`（`:733-737`）上报给宿主注册的 `onError`，例如 TUI 的 `interactive-mode.js:1485-1487`（`this.showExtensionError(...)`）、print 模式的 `console.error`（`print-mode.js:79-81`）、RPC 的 `extension_error` 事件（`rpc-mode.js:345-347`）。因此：

- handler 抛错 **不会**影响提示框显示/关闭，也不会中断 agent；
- handler 耗时长 **不会**阻塞提示框（只是 `emit` 的 Promise 长时间挂起）；
- handler 永不 resolve 只会泄漏一个挂起的 Promise，后续事件的派发不受影响（每次事件各自 `queueMicrotask`）。

注意：pi-guard 现有的 `tool_call` 分支用的是 `emitToolCall`，该函数**没有** `try/catch`（`runner.js:855-871`，`await handler(event, ctx)` 在 `:862`），与文档「`tool_call` errors block the tool (fail-safe)」（`docs/extensions.md:3002`）一致；但 `ui_prompt_*` 走的是带 `try/catch` 的 `emit`，两者容错语义不同。

### A5. 返回值是否被使用：不使用（不能修改或取消提示）

**【源码证实】** `emit` 只在 `isSessionBeforeEvent(event)`（`session_before_switch/fork/compact/tree`，`runner.js:707-712`）时读取 handler 返回值并支持 `cancel`（`:724-729`）。`ui_prompt_start` / `ui_prompt_end` 的 handler 返回值被完全忽略；事件对象本身也**没有**可写的控制字段（`types.d.ts:629-641` 只有 `type/reason/kind/title`，全为只读语义）。因此：

- 不能通过 handler 修改提示内容（`event.title` 是副本，改它不影响对话框）；
- 不能取消/跳过提示；
- `ui_prompt_start` 的 `title` 可能缺失（`title?: string`；`custom` 恒缺失，见 `runner.js:325`）。

### A6. 是否可能一次提示触发多次 / 是否可能形成循环

**【源码证实】** 对同一次「最外层提示」：**恰好 1 次 start + 1 次 end**，不会重复。

**【源码推断，高置信】** 循环风险来自 handler 自身再次发起提示：

- 在 `ui_prompt_start` handler 内调用 `ctx.ui.confirm`：此刻 `uiPromptDepth ≥ 1`（microtask 执行时外层尚未 settle），新调用**不**产生新的 start/end（被合并）。
- 在 `ui_prompt_end` handler 内调用 `ctx.ui.confirm`：`finish` 已在 `:336` 把 `uiPromptDepth` 归零，因此这会被视为**新的最外层提示**，再发一对 start/end；若该 handler 无条件这样做，会形成「提示 → end → 再提示」的无限循环（TUI 下表现为反复弹框，RPC 下表现为 `extension_ui_request` 风暴）。
- 边界情形（推断）：若 `run()` 返回的 Promise 立刻 settle（见 F 节的 RPC `custom()` 立即返回、`signal` 已 abort 等），`finish` 的 microtask 可能在外层 start handler 的 await 之前就执行完，使深度提前归零，从而把 handler 内的嵌套提示「升级」为新的最外层提示——设计通知 handler 时应避免在 `ui_prompt_*` handler 里再调用 `ctx.ui.*` 对话框方法。

---

## B. 覆盖范围：扩展 UI 提示 vs Pi 内置对话框

### B1. 明确覆盖（源码证实）

只有通过 `ctx.ui`（即 `runner.uiContext`）调用的这 5 个方法：`select`、`confirm`、`input`、`editor`、`custom`（`runner.js:318-327`）。`ctx.ui` 的 getter 直接返回该对象（`runner.js:553-556`）。

### B2. 明确不覆盖

**【源码证实】** `wrapUIPromptContext` 用 `...ui` 透传其余所有方法（`runner.js:320`），所以 `notify`、`setStatus`、`setWidget`、`setFooter`、`setHeader`、`setTitle`、`setEditorText`、`pasteToEditor`、`setTheme`、`setToolsExpanded`、`onTerminalInput` 等都**不产生** `ui_prompt_*` 事件。

**【源码证实】** 当 `setUIContext` 收到 falsy 值时直接使用 `noOpUIContext`（`runner.js:315`），该对象**完全没有被包裹**（其定义位于 `runner.js` 类定义之前，≈139-173 行），因此无 UI 模式下即使有人调用 `ctx.ui.confirm` 也不会发事件。

### B3. Pi 内置对话框不经过该包装（源码推断，证据较强）

证据链：

1. **PR 文件清单**：引入该事件的 PR [#8355](https://github.com/earendil-works/pi/pull/8355)（merged 2026-08-27）只改了
   `CHANGELOG.md`、`docs/extensions.md`、`src/core/extensions/index.ts`、`src/core/extensions/runner.ts`、`src/core/extensions/types.ts`、`src/index.ts`——
   **没有**触碰 `modes/interactive/**` 或 `modes/rpc/**`，即内置对话框代码路径未被改动（PR 描述也只提 `ctx.ui.*` 五个方法）【直接证据，非本机源码】。
2. **实现分层**：TUI 模式为扩展单独构造 UI 上下文：`interactive-mode.js:1432-1436`
   ```js
   1432  async bindCurrentSessionExtensions() {
   1433      const uiContext = this.createExtensionUIContext();
   1434      await this.session.bindExtensions({
   1435          uiContext,
   1436          mode: "tui",
   ```
   说明「扩展 UI 上下文」是一个**专为扩展构造的对象**，而不是 TUI 自身的对话框入口。
3. **内置对话框是独立组件**：`interactive-mode.js:58-77` 的导入清单里同时存在两组组件——
   扩展提示用：`ExtensionSelectorComponent`（:60）、`ExtensionInputComponent`（:59）、`ExtensionEditorComponent`（:58）；
   内置对话框用：`LoginDialogComponent`（:63）、`ModelSelectorComponent`（:65）、`OAuthSelectorComponent`（:66）、`ScopedModelsSelectorComponent`（:67）、`SessionSelectorComponent`（:68）、`SettingsSelectorComponent`（:69）、`ThinkingSelectorComponent`（:72）、`TreeSelectorComponent`（:74）、**`TrustSelectorComponent`（:75，project trust 提示）**、`UserMessageSelectorComponent`（:77）等。
   这些内置组件由 Pi 自身流程直接挂载，未见其经过 `createExtensionUIContext()`。

结论：**project trust 提示、`/model`、`/resume`（会话选择器）、`/settings`、`/login`、`/tree`、消息选择器等内置对话框都不会发出 `ui_prompt_start`。**

### B4. Pi 是否存在内置的「工具调用审批对话框」

**【源码推断 + 文档负向证据】** 本轮**未发现** 0.87.0 有内置 tool-call approval：

- `docs/extensions.md:876`（`### Tool Events`）起的 `tool_call` 文档只描述「扩展可以 `block`」，未提及任何内置审批流程；`docs/extensions.md:2999-3003`（Error Handling）只说明「`tool_call` errors block the tool (fail-safe)」。
- 官方示例表把审批实现列为**扩展**：`docs/extensions.md:3040` `| permission-gate.ts | Block dangerous commands | on("tool_call"), ui.confirm |`。
- 生态侧检索显示审批/权限能力以第三方 Pi package 形式提供（`pi-permission-system`、`pi-approval-guardian`、`pi-permissions` 等，见 <https://pi.dev/packages/pi-permission-system>），而非 Pi 核心内置——此条为**二手来源、低置信**，仅作旁证。

**推论**：由于 Pi 没有内置审批框，pi-guard 的 `ctx.ui.confirm` 就是 Pi 侧唯一需要通知的「授权等待点」；该等待点**已经**被 `ui_prompt_start` 覆盖。

**验证方法（未证实项）**：在 0.87.0 源码中检索 `TrustSelectorComponent`、`ModelSelectorComponent` 的挂载点，确认其调用链不经过 `ExtensionRunner.getUIContext()`/`createExtensionUIContext()`；以及在真实 TUI 中运行 `/trust`、`/model`，观察是否触发 `ui_prompt_start`。

---

## C. 模式差异（tui / rpc / json / print）

### C1. 文档口径

`docs/extensions.md:3007-3012`（官网同表 <https://pi.dev/docs/latest/extensions>）：

| Mode | `ctx.mode` | `ctx.hasUI` | Notes |
|---|---|---|---|
| Interactive | `"tui"` | `true` | Full TUI with terminal rendering |
| RPC (`--mode rpc`) | `"rpc"` | `true` | Dialogs and notifications via JSON protocol; `custom()` returns `undefined`. |
| JSON (`--mode json`) | `"json"` | `false` | Event stream to stdout; UI methods are no-ops |
| Print (`-p`) | `"print"` | `false` | Extensions run but can't prompt |

### C2. 各模式是否设置扩展 UI 上下文（源码证实）

| 模式 | 绑定代码 | 是否传 `uiContext` | 是否发 `ui_prompt_*` |
|---|---|---|---|
| tui | `interactive-mode.js:1434-1436`（`uiContext` + `mode: "tui"`） | 是（`createExtensionUIContext()`） | **会** |
| rpc | `rpc-mode.js:230-232`（`uiContext: createExtensionUIContext()` + `mode: "rpc"`） | 是（RPC 协议实现，见 `rpc-mode.js:86-...`，`confirm` 走 `createDialogPromise`，`rpc-mode.js:87`） | **会** |
| json / print | `print-mode.js:53-55`：`await session.bindExtensions({ mode: mode === "json" ? "json" : "print", commandContextActions: {...}, onError })`——**没有 `uiContext` 字段** | 否 | **不会** |

**【源码证实】** `hasUI()` 的定义就是「UI 上下文不是 `noOpUIContext`」：`runner.js:364-366`
```js
364  hasUI() {
365      return this.uiContext !== noOpUIContext;
366  }
```
`ctx.hasUI` getter 直接转发（`runner.js:562-565`）。`setUIContext` 对 falsy 值不包装（`runner.js:315`）。

**【源码推断，逻辑上二选一都成立】** print/json 模式下若 `bindExtensions` 完全不调用 `setUIContext`，`uiContext` 保持构造时的 `noOpUIContext`；若调用则收到 `undefined` 也被替换为 `noOpUIContext`。两种路径结果相同：`hasUI === false` 且不会发出 `ui_prompt_*`。（未逐行读到 `session.bindExtensions` 内部对 `setUIContext` 的调用点——见「未证实项」。）

### C3. pi-guard 在无 UI 模式下的分支

**【源码证实】** `plugins/pi-guard/src/policy.ts`：
- `confirmCommand`：`:32` `if (!ctx.hasUI) { return headless === "allow" ? { deny:false, reason:"" } : { deny:true, reason: "... (no confirmation UI is available)" } }`（`:32-37`），只有 `hasUI` 为真才走 `ctx.ui.confirm`（`:38-41`）。
- `confirmStdinInput`：`:64` 同样的 `!ctx.hasUI` 短路（`:64-69`），否则 `:66` 调 `ctx.ui.confirm`。

`GuardContext` 只依赖 `Pick<ExtensionContext, "hasUI">` 与 `ui: Pick<ExtensionContext["ui"], "confirm" | "notify">`（`plugins/pi-guard/src/types.ts:54-56`）。

**结论**：print/json 模式下 pi-guard 不会调用 `ctx.ui.confirm`，因此也**不会**有 `ui_prompt_start`；两种「不发事件」的原因（不调用 + 未被包装）互相冗余，不存在漏报风险。RPC 模式下 `hasUI === true`，pi-guard 会弹框，并且**会**发出 `ui_prompt_start`（这对「RPC 宿主做通知」是好消息：宿主可据此显示「等待用户」）。

---

## D. 版本兼容

### D1. 引入版本：0.84.4

**【源码证实】**
- `CHANGELOG.md:217`：`## [0.84.4] - 2026-08-28`
- `CHANGELOG.md:222`：`- **Extension UI prompt events** — Integrations can distinguish active agent work from time spent waiting for `ctx.ui` prompts.`
- `CHANGELOG.md:231`：`- Added \`ui_prompt_start\` and \`ui_prompt_end\` extension events ... ([#8355](https://github.com/earendil-works/pi/pull/8355) by [@cristinaponcela](...))`
- 发布说明（公开）：<https://pi.dev/news/releases/0.84.4>
- PR：<https://github.com/earendil-works/pi/pull/8355>（MERGED，2026-08-27；提交序列含 `ada7ce7 fix: handlers should not delay the prompt`，与「handler 不被 await」的结论一致；PR 正文：*"We needed to expose events for when a UI prompt has started or ended so clients can show stuff like 'Waiting for user input' instead of just 'Agent working'."*）

0.87.0 的 `CHANGELOG.md:1-30` 未再改动该事件（0.87.0 的破坏性变更集中在 `turn_end`/`agent_before_settle`/`context_with_edit` 等边界 API，见 `CHANGELOG.md:16-20`）。

### D2. 与 pi-guard `peerDependencies` 下限 `>=0.84.2` 的冲突

**【源码证实】** 0.84.2（`CHANGELOG.md` 中 `## [0.84.2] - 2026-08-14` 段落）与 0.84.3（`## [0.84.3] - 2026-08-24` 段落）的 Added 列表**均不含** `ui_prompt_start`；该事件首次出现在 **0.84.4**。因此：

- `peerDependencies: ">=0.84.2"` 允许安装 0.84.2 / 0.84.3；
- 在这两个版本上，`ui_prompt_start` **不存在**（既无类型重载，也无运行时派发）。

### D3. `pi.on()` 对未知事件名的行为：静默接受，不报错

**【源码证实】** 注册路径 `dist/core/extensions/loader.js:202-219`（`createExtensionAPI` 的 `api.on`）：

```js
202  on(event, handler) {
203      assertActive();
204      const registeredHandler = (...args) => handler(...args);
205      const list = extension.handlers.get(event) ?? [];
206      list.push(registeredHandler);
207      extension.handlers.set(event, list);
208      return () => { /* 按 index 移除，空列表时 delete(event) */ };
219  },
```

- **没有任何事件名白名单/枚举校验**（对比 `registerTool` 会校验 `parameters` 是对象，`:220-223`）。
- 派发侧按事件名字符串取 handler：`snapshotEventHandlers(extensions, event.type)`（`runner.js:95-97`），`emit` 使用同一 key（`runner.js:720`）。
- 结论：**在 0.84.2/0.84.3 上注册 `pi.on("ui_prompt_start", ...)` 不会抛错，只是该 handler 永不执行**（`emitUIPromptEvent` 不存在，自然没有任何派发）。这与官方文档「Extension errors are logged, agent continues」（`docs/extensions.md:3001`）无关，是更「安全」的一类兼容行为。

### D4. 类型层面 vs 运行时层面

- **类型层面**：`ExtensionAPI.on` 是字面量联合重载（`types.d.ts:980-1019`，其中 `ui_prompt_start` 在 `:1002`）。若用户所在版本的类型里没有该重载，对 pi-guard 源码做 `tsc --noEmit` 会报错。
- **运行时层面**：Pi 通过 **jiti 直接转译加载 TypeScript，不做类型检查**：`loader.js:391-412`（`loadExtensionModule`）构造 jiti（`moduleCache: false`，`:410-413`）后 `await jiti.import(extensionPath, { default: true })`（`:412`）。仓库既有调研也记录了这一事实（`docs/research/pi-extension-development.md`：「Pi 通过 jiti 直接转译并加载 TypeScript，通常不需要构建产物」）。
- **推论**：类型不匹配**不会**导致安装/加载失败；但会污染使用者的类型检查体验，且本仓库 `bun run verify` 是对本机 0.87.0 做类型检查，**不会**暴露「在 0.84.2 上不存在」的问题。

### D5. 两种策略的版本代价

**方案 X：依赖 `ui_prompt_start`**
- 必须把 `peerDependencies` 下限提到 `>=0.84.4`（否则 0.84.2/0.84.3 用户「装了但收不到通知」，静默失效）；或
- 保持 `>=0.84.2` 并在运行时探测：例如用公开导出的 `VERSION`（`dist/index.d.ts:2` 导出 `VERSION`）做 semver 比较（`semver` 已是 pi 的依赖，但**不是** pi-guard 的依赖，需自行加入或手写比较），或用「注册后标记 + 首次事件到达才启用」的自适应策略（更简单，但只能「少通知」不能「补通知」）。

**方案 Y：不依赖该事件（在自身 `ctx.ui.confirm` 之前直接通知）**
- 对 Pi 版本**无额外要求**，`>=0.84.2` 甚至更早都可用；
- 覆盖范围仅限 pi-guard 自己的提示（不会给别的扩展的提示发通知）；
- 代价：pi-guard 需要在两处调用点（`policy.ts:38`、`:66`）各自触发一次通知，并自行处理「通知失败静默降级」「去重/冷却」。

---

## E. 替代观测点对比

| 观测点 | 语义 | 能否覆盖 Pi 内置对话框 | 能否拿到标题/类型 | 证据 |
|---|---|---|---|---|
| `ui_prompt_start` / `ui_prompt_end` | Pi 开始/结束阻塞等待**扩展** `ctx.ui` 提示 | 否 | 能：`kind`（5 类）+ `title?` | `types.d.ts:629-641`；`runner.js:328-359`；`docs/extensions.md:608-626`【源码证实】 |
| `tool_call`（pi-guard 现有钩子） | 工具执行前拦截；可 `block` | 否（它是工具门，不是 UI 观测点） | 能拿到 `toolName`/`input`，但**拿不到**「是否正在等待用户」 | `docs/extensions.md:876-879`；`runner.js:855-871`【源码证实】 |
| `input` 事件 | 用户输入被接收（`source: interactive/rpc/extension`，含 `streamingBehavior`） | 否 | 有 `text`/`source`，但只在「已提交输入」时触发，**不能**表示「正在等待」 | `types.d.ts:721-728`（`InputSource`/`InputEvent` 起点）；`docs/extensions.md:1000-1020`【源码证实】 |
| `agent_settled` | 一次 agent run 完全 settle 后触发，此时 `ctx.isIdle() === true` | 否 | 无标题/类型 | `types.d.ts:624-626`；`docs/extensions.md:601-606`【源码证实】 |
| `ctx.isIdle()` | 运行时是否空闲 | 否 | 无 | `runner.js` createContext 中 `isIdle` 转发 `contextActions.isIdle`（≈595-598）；文档 `docs/extensions.md:987` 段【源码证实】 |
| `ctx.ui.notify` / `setStatus` / footer 可见状态 | 扩展主动写状态栏/页脚 | 不适用（是输出而非观测） | 无 | `runner.js:320`（透传，不发事件）【源码证实】 |
| 轮询 `/session` 或状态行文本 | 靠可见状态判断 | 否 | 无 | 未调研 |

**能力差异结论**：

1. `ui_prompt_start` 是**唯一**能表达「Pi 正在等待用户」的扩展事件，但覆盖面仅限扩展 `ctx.ui` 提示。
2. **没有任何扩展事件覆盖 Pi 内置对话框**（B3 证据）。若需求是「所有需要用户操作的时刻都通知」，Pi 0.87.0 的公开扩展 API 无法满足——只能靠 `ui_prompt_start`（扩展提示）＋ 自身调用点埋点（pi-guard 自己的提示）。
3. `agent_settled` 只能表示「本轮结束」，无法区分「跑完」与「等用户确认」，且 pi-guard 的 `ctx.ui.confirm` 发生在 run 内部（`tool_call` 阶段），此时 run 尚未 settle。

---

## F. 在 `ui_prompt_start` handler 里做「系统通知」的注意事项

1. **不能阻塞、不能抛错影响主流程**——正确，但机制需要说清：
   - 事件派发在 microtask 中（`runner.js:355-359`），handler 不被 await，**同步阻塞只会卡住事件循环**（进而卡住 TUI 渲染），异步 `await` 则不会阻塞对话框；
   - handler 抛错会被 `emit` 的 `try/catch` 捕获并通过 `emitError` 上报（`runner.js:722-737`），在 TUI 下会变成一条扩展错误提示（`interactive-mode.js:1485-1487`），因此**通知失败必须自己吞掉**，不要让它冒泡成用户可见错误；
   - 建议：`try { ... } catch { /* 静默 */ }`，且不要 `await` 通知进程的完成（fire-and-forget，`child.unref()`，并挂 `'error'` 监听避免 `EPIPE/ENOENT` 触发未处理异常）。
2. **不要在 `ui_prompt_*` handler 里调用 `ctx.ui.*` 对话框方法**——会造成 A6 描述的合并语义混淆，`ui_prompt_end` 里调用甚至会形成无限循环。
3. **会收到其他扩展的提示**——handler 对所有扩展的 `ctx.ui` 提示都会触发；`event.title` 可做过滤，但 title 不是稳定标识（pi-guard 的标题是 `"Confirm dangerous command"` / `"Confirm PTY input"`，见 `policy.ts:39`、`:66`）。若只想通知自己的提示，需在调用 `confirm` 前设置模块级标志位（同步设置、`await confirm` 之后清除；microtask 中的 handler 能看到该标志），或用 `kind === "confirm"` + title 白名单做粗过滤。
4. **不要假设「等待」会持续很久**——存在 start/end 背靠背的假阳性：
   - RPC 模式 `ctx.ui.custom()` 立即 `return undefined`（`rpc-mode.js:180-183`，文档也说明 `custom()` returns `undefined`，`docs/extensions.md:3010`）；
   - RPC 的 `createDialogPromise` 在 `opts.signal.aborted` 为真时立刻 resolve（`rpc-mode.js:62-63`），`opts.timeout` 到期也会立刻 resolve（`:72-77`）。
   pi-guard 自身调用 `confirm` 不传 `opts`（`policy.ts:38-41`、`:66`），不会命中这两条，但通用 handler 不应把 start 当作「用户一定在等」。
5. **通知内容与命令注入**——不要把完整危险命令拼进 shell 字符串执行通知（命令文本来自模型，含任意字符）。使用 argv 形式（`pi.exec(command, args)`，`loader.js:304-307`；或 `node:child_process.spawn`）并把内容作为参数/标准输入传入；对 macOS `osascript -e 'display notification "..."'` 这类必须内联文本的场景，需转义或改用 `display notification` 的替代传参方式，且建议只发 `summarizeCommand()` 截断后的文本（`plugins/pi-guard/src/policy.ts:5-8`）。
6. **频率控制**——一次批量工具调用可能连续触发多个危险命令确认，需要冷却/去重（例如同一会话 N 秒内只通知一次）。
7. **`notify` 与系统通知的分工**——`ctx.ui.notify` 只在 Pi 界面内可见（TUI 里用户已经在看，通知价值低；RPC 下是 JSON 消息），系统级通知的价值场景是「用户切到别的窗口」。两者不冲突，但不要互相替代。
8. **无 UI 模式**——print/json 下事件根本不会触发（C2/C3），所以 handler 不需要处理 `hasUI === false` 的通知路径；但若采用方案 Y（自行在 confirm 前通知），必须把通知放在 `if (!ctx.hasUI) return ...` **之后**，否则 headless 运行时会发无意义通知。

---

## 对 pi-guard 的可选方案清单

### 方案 1：在自身 `ctx.ui.confirm` 之前直接触发通知（不依赖新事件）

- **机制**：在 `policy.ts` 的 `confirmCommand`（`:32-41`）与 `confirmStdinInput`（`:64-66`）中，`ctx.hasUI` 判定通过后、调用 `ctx.ui.confirm` 之前，触发一次 fire-and-forget 系统通知。
- **版本兼容代价**：无。`peerDependencies` 保持 `>=0.84.2` 即可，也不受 0.84.4 之前版本限制。
- **覆盖范围**：仅 pi-guard 自己的两类确认框（`Confirm dangerous command` / `Confirm PTY input`）；**不覆盖** Pi 内置对话框（内置对话框本来也不会触发 `ui_prompt_start`，所以此方案与方案 2 在这一点上等价）；不覆盖其他扩展的提示（这通常是优点）。
- **失败模式**：通知命令缺失/失败必须静默（否则 `tool_call` handler 抛错会按 fail-safe 阻断工具，见 `docs/extensions.md:3002`）；若 `confirm` 立即返回（取消、超时、异常），会产生一次多余通知；需要在两处调用点重复埋点，未来新增确认点容易漏。
- **证据支撑**：`policy.ts:32-41`、`:64-66`；`hasUI` 语义 `runner.js:364-366`。

### 方案 2：监听 `ui_prompt_start`，按 `kind`/`title` 过滤后通知

- **机制**：`pi.on("ui_prompt_start", (event) => { if (event.kind === "confirm") notify(event.title); })`，并把通知实现做成幂等、静默降级。
- **版本兼容代价**：需要 `ui_prompt_start`（**0.84.4+**）。两种落地方式：
  - 2a：把 `peerDependencies` 下限提到 `>=0.84.4`（并同步 `devDependencies`；本仓库约定见 `AGENTS.md`），语义最清晰；
  - 2b：保持 `>=0.84.2` 并运行时探测（注册未知事件不报错，`loader.js:202-219`；或读公开导出的 `VERSION`，`dist/index.d.ts:2`）——代价是旧版本静默不通知，且类型重载缺失会让使用者的 `tsc` 报错（运行时不受影响，`loader.js:391-412` 走 jiti 转译）。
- **覆盖范围**：**所有扩展**的 `select/confirm/input/editor/custom` 提示（含 pi-guard 自己的）；不覆盖 Pi 内置对话框。
- **失败模式**：
  - 会给别的扩展的确认框发通知（可用 `title` 白名单缓解，但不稳定）；
  - `event.title` 对 `custom` 恒为空（`runner.js:325`）；
  - 假阳性 start/end 背靠背（RPC `custom()`、已 abort 的 signal、timeout，见 F4）；
  - 在旧版本上「注册成功但永不触发」，静默失效——若不做版本检查，用户很难发现通知没生效；
  - 事件派发在 microtask 且 handler 抛错会被上报为扩展错误（`runner.js:355-359`、`:722-737`），实现必须自吞异常。
- **证据支撑**：`types.d.ts:629-641`、`:1002-1003`；`runner.js:314-359`、`:364-366`；`CHANGELOG.md:217/231`；`docs/extensions.md:608-626`。

### 方案 3（推荐组合）：方案 1 为主 + 方案 2 为可选增强

- **机制**：通知触发点放在 pi-guard 自己的确认调用前（保证在 `>=0.84.2` 上都能工作），同时注册 `ui_prompt_start` handler 作为「能力探测」：若在运行期观察到过 `ui_prompt_start`（说明 Pi ≥ 0.84.4 且扩展提示链路生效），则改由事件驱动通知（拿到统一入口 + `kind`/`title`），并停用方案 1 的埋点，避免重复通知。
- **版本兼容代价**：`peerDependencies` 可保持 `>=0.84.2`；代价是需要一套「一次性探测 + 二选一」的状态机，测试需覆盖两条分支。
- **覆盖范围**：旧版本＝pi-guard 自身提示；新版本＝按过滤条件覆盖扩展提示（可选保持「只通知自己的」语义，做法是在调用 `confirm` 前置标志位）。
- **失败模式**：状态机本身是新的复杂度来源；探测窗口内可能出现一次重复通知；类型层面仍建议用局部类型断言隔离 `ui_prompt_start`（避免在旧版本类型下报错）。
- **证据支撑**：同方案 1、2。

### 不建议的方案：依赖内置对话框通知

若需求扩展为「Pi 自身弹任何框都通知」（例如 `/model`、project trust），**当前公开扩展 API 无解**（B3/B4）。唯一路径是上游新增事件或 hook，属于对外提案，不是本仓库可实现的机制。

---

## 矛盾与争议

1. **「peerDependencies >=0.84.2」与「ui_prompt_start 需要 0.84.4」不一致**（`plugins/pi-guard/package.json` vs `CHANGELOG.md:217/231`）。这不是文档矛盾，而是**能力与声明下限不匹配**：只要 pi-guard 选择依赖该事件，就应显式提升下限或做运行时探测。
2. **「事件发出」是否等于「对话框已显示」**：本报告结论为「不等价」（A1）。文档措辞是「Pi starts waiting on a blocking user-facing extension UI prompt」（`types.d.ts:628` 注释），未承诺渲染时序。若后续有人以「handler 一定在首帧之前执行」为前提写代码，属于超出文档承诺的假设。
3. **RPC 模式是否算「等待用户」**：文档把 RPC 的 `hasUI` 标为 `true`（`docs/extensions.md:3010`），事件也会发出，但「用户」实际是 RPC 客户端。宿主集成需自行区分 `ctx.mode`。
4. **Pi 是否有内置审批框**：本报告倾向「没有」，但依据主要是文档/示例的负向证据 + 第三方生态旁证，**未**在本机源码中穷举证明。见「未证实项」。

---

## 未证实项（含验证方法）

| # | 未证实内容 | 影响 | 验证方法 |
|---|---|---|---|
| 1 | 内置对话框（trust/model/session/…）**确实**不经过 `ExtensionRunner.uiContext` | 决定 B 的结论强度（本报告已给 PR 文件清单 + 组件分层两条证据） | 在 `dist/modes/interactive/interactive-mode.js` 中检索 `createExtensionUIContext` 的定义体，确认其中只使用 `Extension*Component`；再检索 `TrustSelectorComponent` / `ModelSelectorComponent` 的挂载点，确认其不引用该上下文 |
| 2 | print/json 模式下 `session.bindExtensions` 是否显式调用 `runner.setUIContext` | 仅影响 C2 的表述（两种路径结论相同） | 在 `dist/core/agent-session*.js` 中检索 `setUIContext(`，确认 `bindExtensions` 的调用形态 |
| 3 | 0.87.0 是否存在任何内置 tool-call 审批对话框 | 决定是否需要为「内置审批」设计通知 | 全文检索 `dist/` 中的 `approval`/`approve`/`permission`；检查 `dist/core/slash-commands.js` 的内置命令表 |
| 4 | 真实运行中 `ui_prompt_start` 与 TUI 首帧的先后顺序 | 影响通知是否可能「比画面早」 | 写一个最小扩展，在 handler 内 `Date.now()` + 写日志，与 TUI 渲染日志对比 |
| 5 | 0.84.4 之前版本对未知事件的**打包版**（`dist/bundle/cli.js`）行为是否同样静默 | 影响方案 2b | 本轮只验证了未打包实现 `loader.js:202-219`（打包版同源）；可在 0.84.2 安装目录中核对同函数 |
| 6 | 第三方 permission/approval 包是否已使用 `ui_prompt_start` | 影响方案 2 的「噪声」评估 | 抽查 `pi-permission-system` 等包源码 |

---

## 来源清单

**保留（主源，决定结论）**

- `dist/core/extensions/runner.js:314-359` — `setUIContext` / `wrapUIPromptContext` / `withUIPrompt` / `emitUIPromptEvent`，A 节全部结论的根据
- `dist/core/extensions/runner.js:364-366` — `hasUI()` 定义（C 节）
- `dist/core/extensions/runner.js:553-556` — `ctx.ui` getter 返回被包裹对象（结论 3 的根据）
- `dist/core/extensions/runner.js:717-744` — `emit`：handler 串行 await、异常捕获、返回值仅在 `session_before_*` 使用（A3/A4/A5）
- `dist/core/extensions/runner.js:855-871` — `emitToolCall` 无 try/catch，与 `ui_prompt_*` 容错语义不同（A4）
- `dist/core/extensions/types.d.ts:627-641`、`:1002-1003` — 事件类型与 `on()` 重载
- `dist/core/extensions/types.d.ts:624-626`、`:721-728` — `agent_settled`、`InputEvent`（E 节）
- `dist/core/extensions/loader.js:202-219` — `pi.on` 无事件名校验（D3 的关键证据）
- `dist/core/extensions/loader.js:391-412`、`:304-307` — jiti 转译加载（无类型检查）；`pi.exec` 公开 API（D4/F5）
- `dist/modes/interactive/interactive-mode.js:58-77`、`:1432-1436` — 内置对话框组件与扩展 UI 上下文分层（B3）
- `dist/modes/rpc/rpc-mode.js:62-77`、`:86-…`、`:180-183`、`:230-232` — RPC 扩展 UI 上下文、立即 resolve 的边界（C2/F4）
- `dist/modes/print-mode.js:53-55` — print/json 不传 `uiContext`（C2）
- `docs/extensions.md:608-626`、`:3007-3015`、`:2999-3003`、`:3036-3040` — 事件语义、模式表、错误处理、示例表
- `CHANGELOG.md:217`、`:231` — 引入版本 0.84.4（D1）
- <https://github.com/earendil-works/pi/pull/8355> — PR 文件清单与提交信息（B3 直接证据、A3 旁证）
- <https://pi.dev/news/releases/0.84.4>、<https://pi.dev/docs/latest/extensions> — 官网发布说明与文档（与本地一致）
- `plugins/pi-guard/src/policy.ts:5-8`、`:32-41`、`:64-66`；`plugins/pi-guard/src/types.ts:54-56` — 被调研对象
- `docs/research/pi-extension-development.md`（jiti 加载无构建产物）、`docs/research/destructive-command-guard-pi-permission.md`（0.84.2 基线与 `hasUI` 分支约定）

**弃用/降权**

- 第三方包页 <https://pi.dev/packages/pi-permission-system>、`pi-approval-guardian` 等 — 仅作「审批由扩展而非核心提供」的旁证，未逐页核对，低置信
- 搜索结果摘要（YouTube、HN、LobeHub 等）— 与结论无关，未采用
- `dist/bundle/*.js` — 与 `dist/**` 同源，行号不可用，未作为证据

---

## 后续步骤（按价值排序）

1. 补齐「未证实项 1/2/3」：在 `interactive-mode.js` 中定位 `createExtensionUIContext()` 定义体与 `TrustSelectorComponent` 挂载点，把 B3 从「源码推断」升级为「源码证实」；同时确认 0.87.0 无内置审批框。
2. 与维护者确认版本策略：是把 pi-guard 的 `peerDependencies` 提到 `>=0.84.4`（并同步 `devDependencies`），还是保留 `>=0.84.2` + 运行时探测。这决定方案 2 是否可用、是否需要方案 3 的状态机。
3. 设计通知实现的降级契约（静默失败、冷却、内容截断、argv 传参），并为其写不访问真实网络的单测（注入假的 spawn/exec）。
4. 若最终选择「仅通知 pi-guard 自身提示」，直接采用方案 1，无需等待上游。

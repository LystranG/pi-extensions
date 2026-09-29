# pi-subagents 侧「子代理危险工具确认」通道取证

只读取证。目标：判断「子代理被 pi-guard 判危时能否弹确认框」在 pi-subagents 一侧有哪些既有通道，以及子代理扩展加载的确切语义。

---

## 1. 基线版本（实测）

| 组件 | 版本 | 证据 |
| --- | --- | --- |
| pi-subagents（已安装包） | **0.73.1** | `node -p "require('/Users/lystran/.pi/agent/npm/node_modules/pi-subagents/package.json').version"` → `0.73.1` |
| Pi（pi-coding-agent） | **0.87.1** | `pi --version` → `0.87.1`；`node -p "require('/Users/lystran/programming/cairnkv/.pi/npm/node_modules/@earendil-works/pi-coding-agent/package.json').version"` → `0.87.1` |
| @lystran/pi-guard | **0.5.0** | `node -p "require('/Users/lystran/.pi/agent/npm/node_modules/@lystran/pi-guard/package.json').version"` → `0.5.0` |
| dcg | **0.14.0** (`/opt/homebrew/bin/dcg`) | `dcg --version` → `Git SHA: 581accd259ed2f8294a7e3866d1489eeaaa58b19`，`Target: aarch64-apple-darwin` |

关键路径（下文所有 `path:line` 均基于此）：

- `SUB = /Users/lystran/.pi/agent/npm/node_modules/pi-subagents`（安装包，含编译后的 `src/**/*.js`；**注意包内同时有 `.js` 与 `.ts` 引用，实际运行的是 `.js`**）
- `PI = /Users/lystran/programming/cairnkv/.pi/npm/node_modules/@earendil-works/pi-coding-agent`（0.87.1 的 dist）
- `GUARD = /Users/lystran/.pi/agent/npm/node_modules/@lystran/pi-guard`

> 说明：`pi` CLI 实际入口是 `/Users/lystran/.custom-bin/pi`（`exec mise x node@lts -- pi`），本机未在 `~/.pi/agent/npm/node_modules` 下安装 `@earendil-works/pi-coding-agent`；`PI` 取自本仓库可访问的 0.87.1 安装副本，版本号已用 `package.json` 核对一致。**证据等级：源码证实（版本号）；路径选择为推断。**

---

## 2. 逐条事实

### Q1. 子会话 `bindExtensions` 的位置与 mode；是否存在第二处或可注入 UI 的参数

#### 结论 1.1 — 全仓库只有一处 `bindExtensions`，且硬编码 `mode: "print"`，不传 `uiContext`

**证据等级：源码证实**

`SUB/src/runs/shared/child-session.js:291-298`

```js
try {
    await session.bindExtensions({
        mode: "print",
        onError: (error) => launch.onExtensionError?.({ extensionPath: error.extensionPath, event: error.event, error: error.error }),
    });
}
catch (error) {
    session.dispose();
    throw error;
}
```

`grep -rn "bindExtensions" SUB/src SUB/index.js` 在 pi-subagents 全包内**只命中 `child-session.js:291` 一处**。没有第二处，也没有把 `uiContext` 透传出去的参数。

#### 结论 1.2 — 前台与后台子代理走的是**同一段**创建代码，两者都是 `mode: "print"`

**证据等级：源码证实**

- 前台：`SUB/src/runs/foreground/execution.js:317` → `host: "parent"`（同一进程内），调用 `buildInProcessChildLaunch(...)`（`execution.js:267`）。
- 后台：`SUB/src/runs/background/runner-child-launch.js:65` → `host: "runner"`，同样调用 `buildInProcessChildLaunch(...)`（`runner-child-launch.js:13`；调用点 `SUB/src/runs/background/subagent-runner.js:839`，`subagent-runner.js:86` 设 `process.env.PI_SUBAGENT_CHILD = "1"`）。
- 二者最终都落到 `child-session.js:create()` → `pi.createAgentSession(...)`（`child-session.js:276`）→ `session.bindExtensions({ mode: "print" })`（`child-session.js:291`）。

所以「前台用 print、后台用别的 mode」不成立：**两者都是 `print`**。

#### 结论 1.3 — `mode` 不影响 `hasUI`；`hasUI` 只取决于是否传了 `uiContext`

**证据等级：源码证实（Pi dist）**

`PI/dist/core/extensions/runner.js:314-317`

```js
setUIContext(uiContext, mode = "print") {
    this.uiContext = uiContext ? this.wrapUIPromptContext(uiContext) : noOpUIContext;
    this.mode = mode;
}
```

`PI/dist/core/extensions/runner.js:363-365`

```js
hasUI() {
    return this.uiContext !== noOpUIContext;
}
```

`PI/dist/core/extensions/runner.js:132-136`（默认 no-op UI）

```js
const noOpUIContext = {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => { },
    ...
```

`PI/dist/core/extensions/runner.js:199` 构造时 `this.uiContext = noOpUIContext;`；
`PI/dist/core/agent-session.js:2355-2357`：

```js
_applyExtensionBindings(runner) {
    runner.setUIContext(this._extensionUIContext, this._extensionMode);
    runner.bindCommandContext(this._extensionCommandContextActions);
```

因为 pi-subagents 调用 `bindExtensions` 时**没有传 `uiContext`**，所以 `this._extensionUIContext` 为 `undefined` → `setUIContext(undefined, "print")` → `noOpUIContext`。

**关键推论（源码证实）**：子会话里
- `ctx.hasUI === false`
- `ctx.ui.confirm(...)` 恒返回 `false`
- `ctx.ui.notify(...)` 是空操作
- `ctx.mode === "print"`

`ExtensionContext` 的定义与之吻合（`PI/dist/core/extensions/types.d.ts:209-216`）：

```ts
export type ExtensionMode = "tui" | "rpc" | "json" | "print";
export interface ExtensionContext {
    ui: ExtensionUIContext;
    mode: ExtensionMode;
    /** Whether dialog-capable UI is available (true in TUI and RPC modes) */
    hasUI: boolean;
```

`ExtensionBindings` 本身是支持 `uiContext` 的（`PI/dist/core/agent-session.d.ts:143-150`）：

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

**但 pi-subagents 没有任何地方构造或注入它**：`grep -rn "uiContext\|hasUI" SUB/src --include=*.js` 在 pi-subagents 里只命中若干 `ctx.hasUI` 的读取点（`src/extension/index.js`、`src/tui/*`、`src/slash/*`、`src/runs/shared/subagent-prompt-runtime.js:493`），**没有一处写入 `uiContext`**。→ 「是否存在可注入 UI 的参数」：**不存在**。

#### 结论 1.4 — 也不存在 `ui_prompt` 事件旁路

**证据等级：源码证实**

`PI/dist/core/extensions/runner.js:318-333`：`ui_prompt_start` / `ui_prompt_end` 事件**只在 `wrapUIPromptContext` 包裹真实 `uiContext` 时**才发出；`noOpUIContext` 不经过 wrap。所以父会话也无法通过 `ui_prompt` 事件观察到子代理的 confirm 尝试。

#### 结论 1.5 — 落到具体后果（结合 pi-guard 源码）

**证据等级：源码证实**

`GUARD/src/policy.ts:46-67`

```ts
async function confirmCommand(command, reason, rule, config, ctx: GuardContext): Promise<GuardDecision> {
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: `${reason} (no confirmation UI is available)`, rule };
  }
  ...
  const confirmed = await ctx.ui.confirm("Confirm dangerous command", `${summarizeCommand(command)}\n\n${reason}${ruleText}`);
```

`GUARD/src/index.ts:35-52` 每次 `tool_call` 都从 `ctx` 重新取 `hasUI`：

```ts
const guardContext: GuardContext = { hasUI: ctx.hasUI, mode: ctx.mode, ui: ctx.ui, notifier };
...
return decision.deny ? { block: true, reason: decision.reason } : undefined;
```

`GUARD/src/config.ts:9` `headless: "deny"`（默认）；`GUARD/src/config.ts:170` 可被 `DCG_PI_HEADLESS=allow` 覆盖。

→ **pi-guard 进入子代理后，永远不会弹框**：要么 `deny`（默认），要么 `allow`（显式 headless=allow）。

---

### Q2. watchdog 权限仲裁链路：`registerPermissionGate` → `requestWatchdogPermission`

#### 结论 2.1 — 链路发起方是**子会话内部**的 `tool_call` 钩子，注册在子会话自己的 `pi` 上

**证据等级：源码证实**

`SUB/src/runs/shared/subagent-prompt-runtime.js:320-372`（`registerPermissionGate`）

```js
export function registerPermissionGate(pi, permissions, childWatchdog, requestPermission = requestWatchdogPermission) {
    const rules = permissions?.rules;
    if (!rules || Object.keys(rules).length === 0)
        return;
    const rawWatchdogConfig = childWatchdog ? JSON.stringify(childWatchdog) : undefined;
    const timeoutMs = childWatchdog?.agentEndTimeoutMs ?? 30_000;
    const onRuntimeEvent = pi.on;
    onRuntimeEvent("tool_call", async (event, ctx) => {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        const decision = permissionDecision(rules, toolName);
        if (decision === "allow")
            return undefined;
        if (decision === "deny")
            return { block: true, reason: `Blocked by pi-subagents permission rule: '${toolName}' is denied.` };
        if (ctx.signal?.aborted)
            return { block: true, reason: "..." };
        let timeout; let abort; let result;
        try {
            result = await Promise.race([
                requestPermission({ ctx, toolName, args: event.input ?? {}, rawWatchdogConfig, auditPath: permissions.auditPath, ...(ctx.signal ? { signal: ctx.signal } : {}) }),
                new Promise(...),  // ctx.signal abort
                new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Watchdog permission decision timed out after ${timeoutMs}ms.`)), timeoutMs); }),
            ]);
        }
        catch (error) { return { block: true, reason: `... Watchdog permission arbiter failed closed: ${reason}` }; }
        ...
        if (result.approved) return undefined;
        return { block: true, reason: `Blocked by pi-subagents permission rule: ${result.reason}` };
    });
}
```

注册点：`subagent-prompt-runtime.js:440` `registerPermissionGate(pi, config.permissions, config.childWatchdog);` — 这里的 `pi` 是**子会话的扩展 API**（`registerSubagentPromptRuntime(pi, config, ...)`，`subagent-prompt-runtime.js:432`，通过 inline extension factory 注入，见 `SUB/src/runs/shared/child-hooks.js`）。

#### 结论 2.2 — 请求形状（`WatchdogPermissionRequest`）

**证据等级：源码证实**

`SUB/src/watchdog/permission-arbiter.d.ts`（导出签名）与 JS 调用点：

- `ctx`（子会话 `ExtensionContext`，**`hasUI=false`**）
- `toolName: string`
- `args: Record<string, unknown>`（`event.input ?? {}`）
- `rawWatchdogConfig?: string`（JSON 字符串，来自 `resolveChildWatchdogConfig`）
- `auditPath?: string`
- `signal?: AbortSignal`
- 返回 `{ approved: boolean; reason: string; source: "watchdog" | ... }`

`SUB/src/runs/shared/permissions.js:87-92` 审计写入：`appendPermissionAudit(filePath, record)` → JSONL。

#### 结论 2.3 — **消费方不是父会话，也不是人**：是**一次性的 LLM 仲裁 Agent**

**证据等级：源码证实 + 文档证实**

`SUB/src/watchdog/permission-arbiter.js:18-135`，核心：

```js
export function createWatchdogPermissionArbiter(options = {}) {
    return async (request) => {
        ...
        let childConfig;
        try { childConfig = decodeChildWatchdogConfig(request.rawWatchdogConfig); }
        catch (error) { return finish(false, `... configuration is invalid: ${reason}`, "unavailable"); }
        if (!childConfig)
            return finish(false, "Watchdog permission arbiter is unavailable because the child watchdog is disabled.", "unavailable");
        if (request.signal?.aborted || request.ctx.signal?.aborted)
            return finish(false, "Watchdog permission decision was cancelled.", "cancelled");
        ...
        agent = new Agent({
            initialState: {
                systemPrompt,
                model: selection.model,
                thinkingLevel: selection.thinkingLevel,
                tools,
            },
            convertToLlm,
            ...agentStreamOptions(streamFn),
            getApiKey: (providerName) => providerName === selection.model.provider ? auth.apiKey : undefined,
            beforeToolCall: async ({ toolCall }) => toolCall.name === tool.name ? undefined : { block: true, reason: `...` },
            toolExecution: "sequential",
        });
        await agent.prompt(`Tool: ${request.toolName}\nRedacted arguments: ${preview}`);
        ...
        return await Promise.race([
            run(),
            new Promise((resolve) => { timeout = setTimeout(() => { agent?.abort(); resolve(finish(false, "Watchdog permission decision timed out.", "timeout")); }, childConfig.agentEndTimeoutMs); }),
            new Promise((resolve) => { abort = () => { agent?.abort(); resolve(finish(false, "Watchdog permission decision was cancelled.", "cancelled")); }; ... }),
        ]);
    };
}
export const requestWatchdogPermission = createWatchdogPermissionArbiter();
```

工具只有一个：`watchdog_permission_decision`，参数 `decision: "approve"|"deny"` + `reason`（`permission-arbiter.js:10-13`）。

文档亦明确（**文档证实**）`SUB/docs/watchdog.md:181`：

> `ask` pauses that exact tool call and sends a bounded, redacted preview to a one-call arbiter owned by the child watchdog, using the configured child-watchdog model. **The arbiter returns only `approve` or `deny` and does not notify the parent.** A disabled watchdog, missing model/auth, timeout, malformed response, or runtime error denies the call with a clear error.

**关键回答**：这条链路**不是**「子代理 → 父会话 UI」通道。它是一条「子代理 → 子watchdog LLM → 子代理」的自治链路，**不经过任何 UI，也不通知父会话**。

#### 结论 2.4 — 超时 / abort / 失败一律 fail-closed（拒绝）

**证据等级：源码证实**

| 情形 | 结果 | 位置 |
| --- | --- | --- |
| watchdog 配置无效 | `approved: false`, `source: "unavailable"` | `permission-arbiter.js:46-49` |
| watchdog 未启用（`decodeChildWatchdogConfig` 返回 undefined） | `approved: false`, `source: "unavailable"` | `permission-arbiter.js:50-51` |
| signal 已 abort | `approved: false`, `source: "cancelled"` | `permission-arbiter.js:52-53` |
| 超时（`childConfig.agentEndTimeoutMs`） | `approved: false`, `source: "timeout"` | `permission-arbiter.js:113` |
| 仲裁 agent 抛错 | `approved: false`, `source: "timeout"|"error"` | `permission-arbiter.js:121-124` |
| 仲裁 agent 未调用工具 | `approved: false`, `source: "malformed"` | `permission-arbiter.js:106-107` |
| 外层 gate 超时（`childWatchdog?.agentEndTimeoutMs ?? 30_000`） | `{ block: true }` | `subagent-prompt-runtime.js:325,355,358-361` |
| 外层 gate 的 `ctx.signal` abort | `{ block: true }` | `subagent-prompt-runtime.js:334-335, 349-354` |

#### 结论 2.5 — 没有公开导出（不存在 `./watchdog` / `./permissions` 子路径）

**证据等级：源码证实**

`SUB/package.json` 的 `exports` 只有：`.`、`./background-work`、`./external-job-provider`、`./external-runs`、`./agents`、`./inspectors`、`./delegation`、`./capability-ceiling`、`./workflow-resources`、`./required-child-extensions`、`./preflight`、`./control-channel`、`./intercom-bridge`、`./child-tool-plan`、`./shared-types`、`./project-panes`。

**没有 `./watchdog`、没有 `./permissions`、没有 `./child-session`、没有 `./native-supervisor-channel`。**
`requestWatchdogPermission` 仅在 `SUB/src/watchdog/permission-arbiter.js:135` 与 `.d.ts:20` 可见，**无任何 `src/api/*` 转发**。
（`./control-channel` 只导出 `requestAsyncStop`；`./intercom-bridge` 只导出 `resolveIntercomSessionTarget` — 见 `SUB/src/api/control-channel.js`、`SUB/src/api/intercom-bridge.js`。）

→ **第三方扩展不可复用这条通道。**

#### 结论 2.6 — agent frontmatter `permissions` / `permissionRules` 的粒度：**只有工具名，且显式禁止 bash**

**证据等级：源码证实**

`SUB/src/runs/shared/permissions.js:12-30`

```js
export function validatePermissionRules(value, label) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object mapping tool names to allow, ask, or deny.`);
    const result = {};
    for (const [tool, decision] of Object.entries(value)) {
        if (!tool.trim()) throw new Error(`${label} contains an empty tool name.`);
        if (tool === "bash")
            throw new Error(`${label}.bash is unsupported; pi-subagents leaves bash policy to pi-guard.`);
        if (INTERNAL_TOOLS.has(tool))
            throw new Error(`${label}.${tool} is reserved for child coordination and cannot be gated.`);
        if (!DECISIONS.has(decision))
            throw new Error(`${label}.${tool} must be allow, ask, or deny.`);
        result[tool] = decision;
    }
    return Object.keys(result).length ? result : undefined;
}
```

`SUB/src/runs/shared/permissions.js:49-53`

```js
export function permissionDecision(rules, toolName) {
    if (toolName === "bash" || INTERNAL_TOOLS.has(toolName))
        return "allow";
    return rules?.[toolName] ?? "allow";
}
```

`SUB/src/runs/shared/permissions.js:3` `const INTERNAL_TOOLS = new Set(["contact_supervisor", "intercom", "bg_wait", "structured_output"]);`

**回答**：
- 粒度 = **工具名 → `allow | ask | deny`**，**不能按命令内容/参数匹配**。
- `bash` 被显式拒绝配置，且运行时恒为 `allow`。→ 命令级策略被**明确让渡给 pi-guard**（文档同证：`SUB/docs/watchdog.md:183`）。
- frontmatter 解析：`SUB/src/agents/agents.js:1950-1956`（`permission` / `permissions` 二选一，`validatePermissionRules(parseYaml(...))`）。
- 全局配置合并：`resolvePermissionRules(globalConfig, agentRules)`（`permissions.js:42-48`），agent 覆盖 global，`allow` 会删除条目。
- 无规则时 gate 不注册（`subagent-prompt-runtime.js:322-323`），子代理无权限门。

---

### Q3. 其它「子代理向人提问」的通道

#### 结论 3.1 — `contact_supervisor`：子代理侧工具，写文件通道，**父会话轮询消费**

**证据等级：源码证实**

子侧注册：`SUB/src/intercom/native-supervisor-channel.js:178-191`

```js
export function registerNativeSupervisorClient(pi, metadata) {
    if (!metadata || hasTool(pi, "contact_supervisor"))
        return;
    const tool = {
        name: "contact_supervisor",
        label: "Contact Supervisor",
        description: "Contact the parent/supervisor session for a blocking decision, structured interview, or progress update.",
        parameters: ContactSupervisorParamsSchema,
        execute(id, params, signal) { return sendSupervisorRequest(params, metadata, signal, id); },
    };
    pi.registerTool(tool);
}
```

调用点：`SUB/src/runs/shared/subagent-prompt-runtime.js:470-483`（`session_start` 时注册一次）、`:542`（`before_agent_start` 时再试一次）。

metadata 来源：`SUB/src/runs/shared/child-runtime-config.js:9-21`

```js
export function childSupervisorMetadata(config) {
    if (!config.supervisorChannelDir || !config.runId || !config.agent || !config.orchestratorSessionId || config.childIndex === undefined)
        return undefined;
    return { channelDir: config.supervisorChannelDir, runId: config.runId, agent: config.agent, childIndex: config.childIndex, ... };
}
```

`supervisorChannelDir` 何时存在：`SUB/src/runs/shared/child-launch.js:120-125`

```js
let supervisorDir;
if (input.orchestratorIntercomTarget && input.parentSessionId && input.runId) {
    supervisorDir = supervisorChannelDir(input.runId, input.childAgentName, input.childIndex);
    fs.mkdirSync(path.join(supervisorDir, "requests"), { recursive: true });
    fs.mkdirSync(path.join(supervisorDir, "replies"), { recursive: true });
}
```

**→ 通道存在的前提：intercom bridge `active`**（`orchestratorIntercomTarget` 非空）。默认 `mode: "always"`（`SUB/src/intercom/intercom-bridge.js:79-88`，`resolveIntercomBridge` 见 `intercom-bridge.js:138-145`）；`mode: "off"` 或 `"fork-only"`（非 fork）或父会话 id 不可用 → `orchestratorIntercomTarget` 为 `undefined` → **`contact_supervisor` 不注册**。

前台 vs 后台：
- 前台：`SUB/src/runs/foreground/subagent-executor.js:3438` `childBridgeActive = intercomBridgeAppliesToAgent(...)`，`:3665` `orchestratorIntercomTarget: childBridgeActive ? data.intercomBridge.orchestratorTarget : undefined`。→ 前台**可用**（前提 bridge active）。
- 后台：`SUB/src/runs/background/subagent-runner.js:3474 / 3897 / 4291` `orchestratorIntercomTarget: config.controlIntercomTarget`，经 `runner-child-launch.js:43` 透传。→ 后台**可用**（同样前提）。
- 恢复启动：`subagent-executor.js:1739-1740 / 1884-1886` 仍按 `intercomBridge.active` 决定；`recoveryDescriptor.intercomBridge` 也在 `async-resume.js:283` 的白名单内。→ 恢复路径同语义（**源码证实**）。

**等待与超时**（`native-supervisor-channel.js`）：

- `:14` `const DEFAULT_ASK_TIMEOUT_MS = 10 * 60 * 1000;`
- `:65-68` `askTimeoutMs()` 读 `process.env.PI_INTERCOM_ASK_TIMEOUT_MS`
- `:92-106` `waitForReply(channelDir, requestId, deadline, signal)`：250ms 轮询 `replies/<id>.json`，deadline 到 → `throw new Error("Timed out waiting for supervisor reply.")`；`signal.aborted` → `throw new Error("Supervisor request cancelled.")`
- `:113` `const expectsReply = params.reason !== "progress_update";` → **`progress_update` 不等回复**（无 UI 也发得出去）

**父侧消费**：`SUB/src/intercom/native-supervisor-channel.js:663-727`（`poll()`）

```js
pi.sendMessage({
    customType: SUPERVISOR_REQUEST_MESSAGE_TYPE,
    content: requestVisibleText(request),
    display: true,
    details: { id, requestId, reason, expectsReply, runId, agent, childIndex, ..., replyHint: supervisorReplyHint(request.id) },
}, { triggerTurn: true });
```

即：把子代理的请求**作为父会话的一条消息 + 触发父模型新回合**注入，父侧用 `subagent_supervisor({ action: "reply", replyTo })` 回复（`native-supervisor-channel.js:519`）。父侧 host 在 pi-subagents 自己的扩展入口创建：`SUB/src/extension/index.js:435-438` `createNativeSupervisorChannel(pi, state, {...})`。

**父会话不存在时行为**（**推断**，基于源码）：没有人 `poll()` → 请求文件留在 `<TMP>/supervisor-channels/<runId>-<agent>-<idx>/requests/`，子代理在 `waitForReply` 里阻塞至 `askTimeoutMs()`（默认 10min）后抛 `Timed out waiting for supervisor reply.`。`PI_INTERCOM_ASK_TIMEOUT_MS` 可调。**等级：推断（源码证实了超时与轮询逻辑，未实测父会话消失场景）。**

**这是不是「子代理 → 父会话 UI」通道？** 部分算，但**不是 UI 弹窗，也不是可被第三方扩展复用的 API**：
- 它是**模型可见的工具**（LLM 调用 `contact_supervisor`），不是扩展可主动调用的函数。
- 入口 `createNativeSupervisorChannel` / `registerNativeSupervisorClient` **不在 `package.json#exports` 中**（见 2.5）。
- 父侧呈现形式是 `pi.sendMessage(...)` + `triggerTurn`，**不是 `ctx.ui.confirm`**；无 UI 的父会话也能收到（消息进 transcript），但不会弹框。

#### 结论 3.2 — `intercom` 外部桥：可选，不在 pi-subagents 内

**证据等级：文档证实 + 源码证实**

`SUB/docs/configuration.md:461`：「Native supervisor messaging **does not require** an external `pi-intercom` installation ... Agents can still use an external `intercom` tool when they explicitly request a provider that supplies it.」
`SUB/docs/workflows.md:494`：「Generic `intercom` remains available only when an explicitly loaded external provider supplies it.」

`SUB/src/intercom/intercom-bridge.js:174` 只把 `contact_supervisor` 加入桥接工具集：

```js
const bridgeTools = ["contact_supervisor"];
```

且**只在 agent 已声明显式 `tools` allowlist 时才追加**（`intercom-bridge.js:175-177`）：`agent.tools && agent.tools.length > 0 ? [...agent.tools, ...bridgeTools...] : agent.tools`。

`SUB/src/api/intercom-bridge.js` 公开的只有 `resolveIntercomSessionTarget`。

#### 结论 3.3 — watchdog child-status / FleetView attention：**单向状态投影，不能承载确认**

**证据等级：源码证实**

事件名与形状：`SUB/src/watchdog/child-status.js:3` `CHILD_WATCHDOG_STATUS_EVENT = "subagent.watchdog.status"`，`:124-146` 校验器：

```js
return event.type === CHILD_WATCHDOG_STATUS_EVENT
    && typeof event.seq === "number" ...
    && typeof event.phase === "string" && CHILD_WATCHDOG_PHASES.includes(event.phase)
    && validWarning;
```

`CHILD_WATCHDOG_PHASES = ["idle", "reviewing", "stale", "failed"]`（`child-status.js:4`）；warning 字段集为 `severity/importance/category/summary/evidence/recommendedAction/addressed/stalemate`（`:130-136`）。

→ 这是一个**只能被读取的状态快照**（run/agent/childIndex/phase 上一次 warning），**没有 requestId、没有 replies 目录、没有 reply 写回路径**。它不能承载「确认」。FleetView / `needs_attention` 同理（`SUB/src/runs/background/subagent-wait.js:160`、`wait-subscriptions.js:191` 通过 `child.currentTool === "contact_supervisor"` 推断「需要人介入」，但**介入动作仍然是 `contact_supervisor` 通道**）。

---

### Q4. 子代理扩展加载入口的确切语义

#### 结论 4.1 — 三个独立来源，最终在 `resolvePiLaunchToolPlan` 合成为 `extensionArgs`

**证据等级：源码证实**

`SUB/src/runs/shared/child-tool-plan.js:266-293`

```js
const disableAmbientExtensions = capabilityCeiling?.denyExtensions === true ||
    input.extensions !== undefined;
const warnings = [];
// An explicit empty list disables ambient extensions, including model providers.
if (capabilityCeiling?.denyExtensions !== true && Array.isArray(input.extensions) && input.extensions.length === 0) {
    const agentLabel = input.agentName ? ` for agent '${input.agentName}'` : "";
    warnings.push(`extensions: [] override${agentLabel} disables ALL ambient extensions for this child (not just "adds nothing"), `
        + "including any model-provider extension needed to resolve a provider-qualified model. "
        + "List the extensions this child actually needs instead of an empty array.");
}
const configuredExtensions = capabilityCeiling?.denyExtensions
    ? []
    : [
        ...toolExtensionPaths,
        ...(input.extensions ?? []),
        ...(input.subagentOnlyExtensions ?? []),
    ];
const ordinaryExtensionArgs = disableAmbientExtensions
    ? [...new Set([...runtimeExtensions, ...configuredExtensions])]
    : [
        ...new Set([
            ...runtimeExtensions,
            ...toolExtensionPaths,
            ...(input.subagentOnlyExtensions ?? []),
        ]),
    ];
// Host-required paths have final precedence and cannot be removed by agent defaults or overrides.
const extensionArgs = [...new Set([...ordinaryExtensionArgs, ...requiredExtensions.map(({ path }) => path)])];
```

`toolExtensionPaths`（同文件 `:205-208`）= `tools` 里看起来像路径的条目（含 `/` 或 `.ts`/`.js` 结尾）：

```js
const toolExtensionPaths = capabilityCeiling?.denyExtensions
    ? []
    : (input.tools ?? []).filter((tool) => !requestedBuiltinTools.includes(tool) &&
        (tool.includes("/") || tool.endsWith(".ts") || tool.endsWith(".js")));
```

**注意**：当 `extensions` **未声明**（`undefined`）且 `denyExtensions` 非真时，`disableAmbientExtensions=false`，此时 `input.extensions` 不在 `ordinaryExtensionArgs` 里（本来就 undefined），但 **`subagentOnlyExtensions` 仍然生效**（`:289`）。

#### 结论 4.2 — agent frontmatter 字段与相对路径解析

**证据等级：源码证实**

`SUB/src/agents/agents.js:1923-1924`

```js
const extensions = resolveAgentRelativeExtensionPaths(parseFrontmatterList(frontmatter.extensions), filePath);
const subagentOnlyExtensions = resolveAgentRelativeExtensionPaths(parseFrontmatterList(frontmatter.subagentOnlyExtensions), filePath);
```

`SUB/src/agents/agents.js:1802-1813`

```js
function resolveAgentRelativeExtensionPaths(paths, agentFilePath) {
    if (paths === undefined) return undefined;
    const baseDir = path.dirname(agentFilePath);
    return paths.map((entry) => {
        const trimmed = entry.trim();
        if (trimmed === "." || trimmed === ".." || trimmed.startsWith("./") || trimmed.startsWith("../")) {
            return path.resolve(baseDir, trimmed);
        }
        return entry;
    });
}
```

- 相对路径（`./`、`../`）**相对 agent 定义文件所在目录**解析成绝对路径。
- 其他形式的字符串原样传递（交给 Pi 的 package manager 解析，见 4.6）。

#### 结论 4.3 — settings 的 `subagents.defaultExtensions` / `defaultSubagentOnlyExtensions`

**证据等级：源码证实**

`SUB/src/agents/agents.js:931-945`（解析 + 校验：非空字符串数组）
`SUB/src/agents/agents.js:1084-1096`

```js
function applySubagentDefaultExtensions(agents, defaultExtensions) {
    if (defaultExtensions === undefined) return agents;
    return agents.map((agent) => {
        if (agent.extensions !== undefined) return agent;      // agent 已声明 → 默认值不覆盖
        const next = { ...agent, extensions: [...defaultExtensions], extensionsFromDefault: true };
        ...
    });
}
```

`SUB/src/agents/agents.js:1102-1113` 同理处理 `subagentOnlyExtensions`；优先级：project settings > user settings（`:1080-1082`、`:1098-1100`）。

#### 结论 4.4 — `registerRequiredChildExtensions`（`pi-subagents/required-child-extensions`）

**证据等级：源码证实**

`SUB/src/shared/required-child-extensions.js:56-68`

```js
export function registerRequiredChildExtensions(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "sessionId" && key !== "extensions"))
        throw new Error("Required child extension registration requires only sessionId and extensions.");
    ...
    const frozen = snapshotRequiredChildExtensions(input.extensions, "Required child extensions", true);
    const store = registry();
    if (store.bySession.has(input.sessionId))
        throw new Error(`Required child extensions are already registered for session '${input.sessionId}'; dispose them first.`);
    store.bySession.set(input.sessionId, frozen);
    return { dispose() { ... } };
}
```

- `snapshotRequiredChildExtensions(..., canonicalizeFiles = true)`（`:8-41`）：`fs.realpathSync` + `statSync(...).isFile()`，**必须是已存在的可导入文件**（≤32 条，path ≤4096 bytes）。这一点比 frontmatter 的 `extensions` 严格。
- 存储：`globalThis[Symbol.for("pi-subagents.required-child-extensions.v1")]`（`:43-53`）。
- 消费：`resolveRequiredChildExtensions(sessionId)`（`:69-73`），调用面覆盖：
  - 前台：`SUB/src/runs/foreground/subagent-executor.js:3621`
  - 后台：`SUB/src/runs/background/async-execution.js:849 / 1600`
  - 共有：`SUB/src/runs/shared/child-launch.js:74`、`SUB/src/api/preflight.js:224`

**→ requiredExtensions 能否压过 `extensions: []`？** **能**。`child-tool-plan.js:293` 把它们附加在最后：`[...ordinaryExtensionArgs, ...requiredExtensions.map(p => p.path)]`，注释明确 "final precedence and cannot be removed by agent defaults or overrides"。文档同证（**文档证实**）`SUB/docs/agents.md:380`：

> Required paths follow ordinary extension resolution and **survive agent defaults and `extensions: []`** across native foreground, detached, nested, and recovery launches. A `capabilityCeiling.denyExtensions` conflict or required load/provider-registration failure rejects before model resolution.

**→ 能否压过 `denyExtensions`？** **不能，直接抛错**。`child-tool-plan.js:175-177`：

```js
if (requiredExtensions.length > 0 && capabilityCeiling?.denyExtensions) {
    throw new Error(`Capability ceiling from ${capabilityCeiling.sources.join(", ") || "unknown source"} denies extensions but this host requires: ${requiredExtensions.map(({ id }) => id).join(", ")}.`);
}
```

#### 结论 4.5 — `capabilityCeiling.denyExtensions` 的语义

**证据等级：源码证实 + 文档证实**

- 归一化：`SUB/src/runs/shared/capability-ceiling.js:56` `denyExtensions: ceiling.denyExtensions === true`
- 合并（OR）：`capability-ceiling.js:125` `denyExtensions: active.some((ceiling) => ceiling.denyExtensions)`
- 效果：`child-tool-plan.js:205/209/252/266/276` — 干掉 `toolExtensionPaths`、MCP 解析、permission-system 扩展、`configuredExtensions`，并强制 `disableAmbientExtensions = true`；`fast` 模式直接抛错（`:257-258`）。
- 文档：`SUB/docs/extension-api.md:385`

> `denyExtensions` suppresses ambient, configured, and MCP provider extensions while retaining the package runtime needed for child protocol enforcement. This is a same-process policy boundary, not a sandbox against malicious code already running in the parent process.

公开 API：`pi-subagents/capability-ceiling` 导出 `registerSubagentCapabilityCeiling` 等（`SUB/src/api/capability-ceiling.d.ts`）。

**→ 前台子代理能否加载一个被显式列出路径的本地 `.ts` 扩展？（这是决定 pi-guard 能否进入前台子代理的核心）**

**能。证据等级：源码证实。**

1. frontmatter `extensions: ["./pi-guard/src/index.ts"]` → `agents.js:1923` + `:1802-1813` 解析为绝对路径。
2. → `execution.js:286` `extensions: agent.extensions`（前台）/ `runner-child-launch.js:31`（后台）。
3. → `child-tool-plan.js:276-293` 进入 `configuredExtensions` → `extensionArgs`。
4. → `child-launch.js:186` `const extensionPaths = toolPlan.extensionArgs.filter((p) => !isSubagentRuntimeExtensionPath(p));`
5. → `child-launch.js:206` `extensionPaths` 写入 session launch。
6. → `child-session.js:235` `additionalExtensionPaths: launch.extensionPaths`。
7. → `PI/dist/core/resource-loader.js:316-319`：

```js
const extensionPaths = this.noExtensions
    ? cliEnabledExtensions
    : this.mergePaths(cliEnabledExtensions, enabledExtensions);
const extensionsResult = await this.loadFinalExtensionSet(extensionPaths, preTrustExtensions);
```

其中 `cliEnabledExtensions` 来自 `:277` `await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, { temporary: true })`。

**关键**：`noExtensions: true` **只关掉 ambient/discovered**，`additionalExtensionPaths` **照样加载**。而 `noExtensions` 对前台子代理恒为 `true`：

`child-session.js:230` `noExtensions: !launch.ambientExtensions`；
`child-launch.js:187` `const ambientExtensions = input.host === "runner" && !toolPlan.disableAmbientExtensions;`

→ 前台（`host: "parent"`）**永远** `ambientExtensions = false` → `noExtensions: true` → 只能靠**显式列出的路径**。后台（`host: "runner"`）默认 `ambientExtensions = true`，因此**也能吃到 ambient**（文档同证：`SUB/docs/agents.md:352`、`:447`、`SUB/docs/watchdog.md:183`）。

文档对 pi-guard 场景有直接表述（**文档证实**）`SUB/docs/watchdog.md:183`：

> load `pi-guard` into a child through the agent's `extensions` or `subagentOnlyExtensions`, and background children also pick it up as an ambient extension.

#### 结论 4.6 — 嵌套子代理与恢复启动是否同样生效

**证据等级：源码证实（恢复语义）/ 推断（嵌套具体路径）**

- **恢复启动**：`SUB/src/runs/background/async-resume.js:279-287` 的 descriptor 白名单明确含 `"extensions"`、`"subagentOnlyExtensions"`、`"launchResolvedExtensions"`、`"extensionBindings"`、`"requiredExtensions"`；`applySteeringRecoveryAgentConfig`（`async-resume.js:629-657`）恢复：

```js
extensions: descriptor.extensions ? [...descriptor.extensions] : undefined,
subagentOnlyExtensions: descriptor.subagentOnlyExtensions ? [...descriptor.subagentOnlyExtensions] : undefined,
```

前台恢复路径：`subagent-executor.js:1778-1779`（`applySteeringRecoveryAgentConfig(baseAgentConfig, recoveryDescriptor)`）、`:1735` / `:1868`（`requiredExtensions`）、`:1867`（`extensionBindings`）。

- **嵌套**：`child-tool-plan.js:172-352` 是无状态纯函数，嵌套子代理的步骤由 `subagent-runner.js:506-522` / `:863-879` 用 `step.extensions` / `step.subagentOnlyExtensions` 重新解析（`step` 已在 `subagent-runner.js:510/867` 携带这两字段）。`requiredExtensions` 经 `inheritedChildRuntime`（`child-launch.js:18-31`，`:29` 携带 `requiredExtensions`）与 `subagent-runner.js:520/877` 的 `step.requiredExtensions ?? ctx.inheritedChildRuntime?.requiredExtensions` 传递。文档 `SUB/docs/agents.md:380` 明确覆盖「nested」。
- `dynamic-fanout.js:18` 的持久字段白名单也含 `requiredExtensions`、`launchResolvedExtensions`。

**→ 结论**：frontmatter 的 `extensions`/`subagentOnlyExtensions` 与 required 扩展在嵌套与恢复里都生效；`requiredExtensions` 通过 `inheritedChildRuntime` 单调向下传播。

#### 结论 4.7 — 扩展记录（证据面）

`child-tool-plan.js:103-122` `projectLaunchResolvedChildExtensions` 输出 `{ version, source: "launch-resolved", disableAmbientExtensions, runtime, configured, required, effective, omitted }`，只记 `sha256:<16hex>` 摘要 ID，**不落盘真实路径**（`extensionIdentifier`，`:80-81`）。

---

### Q5. 进程 / cwd / env

#### 结论 5.1 — 前台子代理在父进程内，且强制共享/重置扩展模块缓存

**证据等级：源码证实**

`SUB/src/runs/shared/child-session.js:89-103`

```js
/** One launch at a time from env application through `session_start`, so parallel launches never observe each other's `processEnv` while their extensions load and start. */
let loading = Promise.resolve();
/**
 * pi caches extension factories per process and clears that cache only when a
 * loader reloads a second time, so every child in one process would share each
 * extension's module state. Marking the child's loader as already loaded makes
 * its first `reload()` clear the cache, so the child gets its own instances the
 * way a separate process had them. The flag is a private field of pi's loader.
 */
function resetExtensionCacheOnReload(loader) {
    if (!("loaded" in loader)) return false;
    loader.loaded = true;
    return true;
}
```

`child-session.js:244-245`

```js
if (!resetExtensionCacheOnReload(loader) && (launch.ambientExtensions || launch.extensionPaths.length))
    launch.onExtensionError?.({ extensionPath: "<loader>", event: "load", error: new Error("pi's extension cache reset is unavailable; extensions loaded into this child share module state with other sessions in this process.") });
```

→ **前台 child 的扩展在父进程里加载**（同一 Node 进程），但通过 `loader.loaded = true` 触发 pi 的扩展工厂缓存清零，使每个 child 拿到**自己的模块实例**。所以 `pi-guard` 在子会话里会**重新执行一次扩展工厂**（即 `piGuardExtension(pi)`，`GUARD/src/index.ts:19`），并重新调用 `loadGuardConfig()`。

#### 结论 5.2 — pi-guard 用 `process.cwd()` 找 `.pi/guard.json`，且在**扩展加载时**求值一次

**证据等级：源码证实**

`GUARD/src/index.ts:19-34`

```ts
export default function piGuardExtension(pi: ExtensionAPI): void {
  let config: GuardConfig;
  try {
    ensureGuardConfig();
    config = loadGuardConfig();          // ← 只在此处调用一次
  } catch (error) { ... }
  const checker = createDcgChecker(config);
  const notifier = createNotifier({ config: config.notify });
```

`GUARD/src/config.ts:151-154`

```ts
export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): GuardConfig {
  const configPath =
    env.PI_GUARD_CONFIG?.trim() ||
    [join(cwd, ".pi", "guard.json"), join(homedir(), ".pi", "agent", "guard.json")].find(existsSync);
```

**→ 后果**：
- **前台子代理**：扩展在父进程内加载，`process.cwd()` = **父进程的 cwd**（不是子会话的 `session.cwd`）。若某次 subagent 通过 `cwd` 参数指定了不同工作目录，pi-guard 仍会去找**父进程的** `.pi/guard.json`。**等级：源码证实（`process.cwd()` 语义）+ 推断（未实测跨 cwd 场景）。**
- **后台子代理**：runner 是独立进程，`process.cwd()` = runner 的 `spawn cwd`。**等级：源码证实 + 推断。**

`PI_GUARD_CONFIG` 环境变量可覆盖（`config.ts:153`），且 `DCG_PI_HEADLESS`（`config.ts:170`）可覆盖 `headless`。

#### 结论 5.3 — 后台 runner 的 `spawn` cwd 与 env 继承

**证据等级：源码证实**

`SUB/src/runs/background/async-execution.js:483-488`

```js
const proc = spawn(command, args, {
    cwd,
    ...backgroundProcessOptions(),
    stdio: ["ignore", stdoutFd ?? "ignore", stderrFd ?? "ignore"],
    env: runnerEnv,
});
```

`async-execution.js:469-478`

```js
const runnerEnv = {
    ...omitGitRoutingEnv(omitExtensionBindingsEnv(process.env)),
    ...childCacheRetentionEnv(),
    [PI_CODING_AGENT_PACKAGE_ROOT_ENV]: binaryHost ? undefined : piPackageRoot,
    PI_PACKAGE_DIR: binaryHost ? process.env.PI_PACKAGE_DIR : piPackageRoot,
    [JITI_ALIAS_ENV]: binaryHost ? undefined : JSON.stringify(hostPeerAliases.aliases),
    PI_ASYNC_NATIVE_RUNNER: !binaryHost && (runnerIsJavaScript || nativeRunnerSupported) ? "1" : "0",
    PI_SUBAGENT_RUNNER_CONFIG: binaryHost ? cfgPath : undefined,
};
```

- `omitGitRoutingEnv` 只剔除 **git routing** 变量（`SUB/src/runs/shared/git-environment.js:25-27`）。
- `omitExtensionBindingsEnv` 只剔除 `PI_SUBAGENT_EXTENSION_BINDINGS_ENV`（`SUB/src/runs/shared/extension-bindings.js:79-82`）。
- **`PATH` 完整继承** → 后台子代理进程能在 PATH 上找到 `dcg`。**等级：源码证实。**

`backgroundProcessOptions()`（`SUB/src/runs/shared/background-process-options.js:1-6`）只设 `detached` / `windowsHide`，**不动 cwd**。

`cwd` 的取值：`spawnRunner(cfg, suffix, cwd, ...)` 的 `cwd` 来自 `async-execution.js:1200-1204` `cwd: runnerCwd`；`runnerCwd = resolveChildCwd(ctx.cwd, cwd)`（`:651` 和 `:1449`）。

`SUB/src/runs/background/subagent-runner.js:4902`：`installRunnerHttpDispatcher({ agentDir: getAgentDir(), cwd: process.cwd() });` — 直接以 `process.cwd()`（即 spawn cwd）作为 runner 的工作目录。

**→ 后台子代理进程的 `process.cwd()` = `runnerCwd` = `resolveChildCwd(父ctx.cwd, 请求的 cwd)`。** 因此后台 pi-guard 找的是**该 runner 的 cwd 下**的 `.pi/guard.json`，比前台更符合直觉。

全仓唯一 `process.chdir` 在 `SUB/src/workflows/scripted-workflow.js:2014`（`process.chdir(options.processCwd)`），属 scripted workflow 专用路径，不覆盖普通 subagent runner。

#### 结论 5.4 — 后台 runner 的启动方式（影响扩展加载可行性）

**证据等级：源码证实**

`async-execution.js:462-468`

```js
const args = binaryHost
    ? ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-session", "--mode", "rpc", "--extension", bootstrap]
    : runnerIsJavaScript
    ? [...preload, runner, cfgPath]
    : nativeRunnerSupported
    ? [...preload, "--experimental-strip-types", runner, cfgPath]
    : [...preload, jitiCliPath, runner, cfgPath];
```

- `binaryHost`（打包二进制）路径下 runner 以 `--mode rpc --extension binary-bootstrap` 启动，**`--no-extensions`**：ambient 由 bootstrap 自己控制。
- npm/JS-host 路径下 runner 是普通 Node 进程，`pi-subagents` 扩展入口在 `process.env.PI_SUBAGENT_CHILD === "1"`（`SUB/src/extension/index.js:372`，由 `subagent-runner.js:86` 设置）时**注册为空操作**，但**其它扩展不受影响**。

---

## 3. 可用通道与不可用通道

### 不可用（针对「子代理被判危时弹确认框」）

| 通道 | 状态 | 原因（证据） |
| --- | --- | --- |
| `ctx.ui.confirm` 直接弹框 | **不可用** | 子会话 `bindExtensions` 不传 `uiContext` → `noOpUIContext.confirm = async () => false`，`hasUI === false`。`child-session.js:291-294` + `PI/dist/core/extensions/runner.js:132-136/314-317/363-365` |
| `ui_prompt_start` 事件旁路 | **不可用** | 无真实 `uiContext` 时不经过 `wrapUIPromptContext`。`PI/dist/core/extensions/runner.js:318-333` |
| 复用 `registerPermissionGate` / `requestWatchdogPermission` | **不可用** | 无公开导出子路径；且它本身就是 LLM 仲裁、不弹框、不通知父会话。`package.json#exports` + `permission-arbiter.js:135` + `docs/watchdog.md:181` |
| 按命令内容配置 `permissions` 规则 | **不可用** | 粒度只有工具名；`bash` 被显式拒绝/放行。`permissions.js:12-30, 49-53` |
| watchdog child-status / FleetView attention 承载「确认」 | **不可用** | 单向状态投影，无 request/reply 语义。`child-status.js:3, 124-146` |

### 有限可用

| 通道 | 状态 | 约束（证据） |
| --- | --- | --- |
| `contact_supervisor`（子 → 父阻塞提问） | **可用但非 UI、非扩展 API** | 需 `orchestratorIntercomTarget`（intercom bridge `active`，默认 `always`）；子侧只作为 LLM 工具注册；父侧以 `pi.sendMessage + triggerTurn` 呈现；超时默认 10min（`PI_INTERCOM_ASK_TIMEOUT_MS`）。`child-launch.js:120-125`、`native-supervisor-channel.js:14, 92-106, 178-191, 663-727` |
| `capabilityCeiling.denyExtensions` | **可用（收紧侧）** | 公开 API `pi-subagents/capability-ceiling`；会抑制 ambient/configured/MCP 扩展并强制 `disableAmbientExtensions`；与 `requiredExtensions` 冲突则**启动前抛错**。`child-tool-plan.js:175-177, 266` |
| `subagents.defaultExtensions` / `defaultSubagentOnlyExtensions` | **可用（注入侧）** | agent 自己声明 `extensions` 时默认值不覆盖。`agents.js:1084-1096, 1102-1113` |
| agent frontmatter `extensions` / `subagentOnlyExtensions` | **可用（注入侧）** | 相对路径按 agent 文件目录解析；前台子代理**只有这条路**（ambient 永关）。`agents.js:1802-1813, 1923-1924`；`child-launch.js:187` |
| `registerRequiredChildExtensions` | **可用（宿主强制注入）** | 需要在父会话注册 `{ sessionId, extensions: [{id, path}] }`（路径必须是已存在的真实文件）；压过 `extensions: []`，但**不能压过 `denyExtensions`**。`required-child-extensions.js:8-41, 56-68`；`child-tool-plan.js:175-177, 293` |

### 直接回答核心问题

**pi-guard 可以被塞进前台子代理（frontmatter `extensions` / `subagentOnlyExtensions` / `subagentOnlyExtensions` 默认值 / `required-child-extensions` 四条路），但进去之后它一定走 `headless` 分支：默认 `deny`，不会弹框。**

要让它弹框，pi-subagents 这一侧**没有现成通道**；需要 pi-subagents 侧改动（给 `bindExtensions` 传一个 `uiContext`，或把 confirm 需求代理到父会话），或 pi-guard 侧改动（在无 UI 时改用 `contact_supervisor` 之类的子→父通道）。

---

## 4. 未确证项与风险

1. **未实测**：前台子代理实际加载 pi-guard 的端到端行为（如 `ctx.ui.notify` 在 no-op UI 下的静默度、`.pi/guard.json` 落在父进程 cwd 时的实际命中路径）。**等级：推断。**
2. **未确证**：`pi` CLI 实际解析的 `@earendil-works/pi-coding-agent` 安装位置。本报告使用 `/Users/lystran/programming/cairnkv/.pi/npm/node_modules/@earendil-works/pi-coding-agent`（版本已核对为 0.87.1）；`~/.pi/agent/npm/node_modules` 下**没有**该包。若实际宿主 dist 不同，`runner.js` 的行号可能位移（语义应一致）。**等级：未确证。**
3. **风险**：前端子代理的 pi-guard 会与**父会话的 pi-guard 实例并存**（`resetExtensionCacheOnReload` 使 child 拿到独立模块实例），但二者共享**同一个 `process.cwd()`**。若子代理用了不同 cwd，策略会取错配置文件。**等级：推断（源码语义支持）。**
4. **风险**：`extensions: []` 会**关掉所有 ambient 扩展**（包括 provider 扩展）——若为了给子代理加 pi-guard 而写 `extensions: []` + required，可能顺带打断模型解析路径。`child-tool-plan.js:270-275`。**等级：源码证实。**
5. **风险**：`contact_supervisor` 通道依赖 intercom bridge `active`；若父进程是 detached runner 且没有对应的父轮询者，子代理会阻塞至 10 分钟超时（`PI_INTERCOM_ASK_TIMEOUT_MS`），且**无 UI 提示**。**等级：推断。**
6. **未确证**：`applyIntercomBridgeToAgent` 只在 agent 已有显式 `tools` allowlist 时把 `contact_supervisor` 追加进 allowlist（`intercom-bridge.js:175-177`）；`tools` 省略时工具**仍会被 `registerTool` 注册**（`native-supervisor-channel.js:178-191`），但其在最终工具集中的可用性取决于 Pi 的激活逻辑，未逐行追到。**等级：未确证。**
7. **未确证**：pi-guard 在后台 runner 中作为 **ambient 扩展**被发现的必要条件（`~/.pi/agent/settings.json` 的 `packages` 含 `npm:@lystran/pi-guard`，见「检索位置清单」；但 Pi 在 runner 进程里如何解析 packages 未逐行验证）。**等级：未确证。**

---

## 5. 为找这些结论检索过的位置清单

### 版本与安装布局（只读 bash）
- `node -p` 读 `pi-subagents/package.json`、`@lystran/pi-guard/package.json`、`@earendil-works/pi-coding-agent/package.json`
- `pi --version`；`dcg --version`；`which pi` / `readlink -f` / `cat /Users/lystran/.custom-bin/pi`
- `ls ~/.pi/agent/npm/node_modules/{,@lystran,@earendil-works}/`；`find / -maxdepth 10 -type d -name pi-coding-agent`
- `cat ~/.pi/agent/settings.json`（`packages` 列表含 `npm:pi-subagents`、`npm:@lystran/pi-guard`）
- `ls /Users/lystran/programming/ai/pi-extensions/.pi/`、`plugins/`

### pi-subagents 源码（`SUB/src`）
- `runs/shared/`：`child-session.js`、`child-launch.js`、`child-launch-plan.js`、`child-tool-plan.js`、`child-runtime-config.js`、`child-hooks.js`、`permissions.js`、`subagent-prompt-runtime.js`、`capability-ceiling.js`、`extension-bindings.js`、`git-environment.js`、`background-process-options.js`
- `runs/foreground/`：`execution.js`、`subagent-executor.js`、`foreground-history.js`
- `runs/background/`：`async-execution.js`、`subagent-runner.js`、`runner-child-launch.js`、`async-resume.js`、`run-child-session.js`、`control-channel.js`、`subagent-wait.js`、`wait-subscriptions.js`、`fleet-view.js`、`notify.js`、`run-status.js`
- `watchdog/`：`permission-arbiter.js`、`child-status.js`、`types.js`、`turn-delta.js`
- `intercom/`：`native-supervisor-channel.js`、`intercom-bridge.js`、`supervisor-ui.js`
- `agents/`：`agents.js`、`agent-management.js`、`agent-serializer.js`、`runtime-agent-registry.js`
- `shared/`：`required-child-extensions.js`、`utils.js`、`types.js`、`model-info.js`
- `api/`：`*.js` / `*.d.ts`（确认 exports 面包）
- `extension/`：`index.js`（`createNativeSupervisorChannel` 装配点、`SUBAGENT_CHILD` 判定）、`tool-description.js`
- `workflows/`：`scripted-workflow.js`（唯一 `process.chdir`）
- 根：`package.json`（exports）、`index.d.ts`、`runner-peer-preload.mjs`
- docs：`docs/watchdog.md`、`docs/agents.md`、`docs/configuration.md`、`docs/extension-api.md`、`docs/workflows.md`、`docs/tool-reference.md`、`docs/observability.md`

### pi-coding-agent 0.87.1 dist（`PI/dist`）
- `core/extensions/runner.js`（`noOpUIContext`、`setUIContext`、`hasUI`、`wrapUIPromptContext`、`createContext`、`emitUIPromptEvent`）
- `core/extensions/types.d.ts`（`ExtensionMode`、`ExtensionContext`、`ProjectTrustContext`）
- `core/agent-session.js`（`_applyExtensionBindings`）、`core/agent-session.d.ts`（`ExtensionBindings`、`bindExtensions`）
- `core/resource-loader.js`（`noExtensions` / `additionalExtensionPaths` 语义）、`core/resource-loader.d.ts`
- `core/project-trust.js`、`cli/project-trust.js`、`cli/project-trust.d.ts`、`main.js`、`package-manager-cli.js`、`modes/interactive/interactive-mode.js`（`hasUI: true` 的对照）
- `docs/extensions.md`、`docs/rpc-extension-ui.md`、`docs/rpc.md`、`docs/sdk.md`、`docs/configuration.md`（未逐行引用，用于交叉校验）

### pi-guard 0.5.0 源码（`GUARD/src`）
- `index.ts`（扩展入口、`tool_call` 钩子、`GuardContext` 构造）
- `policy.ts`（`confirmCommand`、`confirmStdinInput`、`notifyConfirm`）
- `config.ts`（`loadGuardConfig`、`headless` 默认与 env 覆盖）
- `types.ts`（`GuardContext`、`GuardNotifier`）
- `dcg.ts`（只做 grep 定位，未展开）

# Pi statusline 与 Serena hooks 扩展调研

> 调研基线：本机安装包 `@earendil-works/pi-coding-agent@0.84.2`。本报告以本机包内 `docs/extensions.md`、`docs/tui.md`、`examples/extensions/custom-footer.ts` 及公开类型契约为最终依据，并用官方仓库同名文件交叉定位。在线 `main` 可能晚于 `0.84.2`，实现时不得用在线新增 API 替代本机已验证契约。

## 结论摘要

两个需求均可用公开 extension API 实现，并应拆成两个独立发布包：`@lystran/pi-statusline` 与 `@lystran/pi-serena-hooks`。statusline 应通过 `ctx.ui.setFooter()` 替换内置 footer，组合 `ctx.cwd`、`ctx.sessionManager.getSessionName()`、`ctx.model`、`ctx.thinkingLevel`、`ctx.getContextUsage()` 与 `footerData`；Serena hooks 应监听 `session_start`、`tool_call`、`session_shutdown`，用 `pi.exec("serena-hooks", args, { timeout: 10_000 })` 执行无 shell 命令。

无法精确复刻外部系统的 `SessionStart(startup|resume)` 与泛化 `Stop` 语义：Pi 的事件原因集合更细，且没有名称为 `Stop` 的公开事件。已确认替代方案是每次 `session_start` 都 activate，仅在 `session_shutdown.reason === "quit"` 时 cleanup；这能覆盖 reload/new/resume/fork 后的新会话状态，同时避免在会话切换的中间 shutdown 上误清理新状态。

## 一手来源与版本边界

本机一手依据（包根目录为本机安装的 `@earendil-works/pi-coding-agent@0.84.2`）：

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`：extension factory、事件联合类型、`ExtensionContext`、`ctx.ui`、`pi.exec()`。
- `node_modules/@earendil-works/pi-coding-agent/docs/tui.md` 的 Pattern 6：自定义 footer 的组件模式、主题、宽度截断和失效刷新。
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-footer.ts`：`ctx.ui.setFooter()`、`footerData.getGitBranch()`、`footerData.onBranchChange()`、`footerData.getExtensionStatuses()`、主题和 `truncateToWidth()` 的可运行范例。
- `node_modules/@earendil-works/pi-coding-agent/README.md`：extension 与 Pi package 的入口、加载和分发总览。
- 本仓库 `/Users/lystran/programming/ai/pi-extensions/AGENTS.md`：当前 workspace 的目录、入口、依赖、Node 基线、测试和发布约束。

官方同名文件用于交叉引用：

- [官方 `docs/extensions.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [官方 `docs/tui.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- [官方 `examples/extensions/custom-footer.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts)
- [官方 coding-agent `README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)

包名差异必须保留：本机实际契约来自 `@earendil-works/pi-coding-agent@0.84.2`，不能仅凭上游 `@mariozechner/pi-coding-agent` 的最新文档推断兼容性。

## 1. 可持续刷新的自定义 statusline

### 1.1 公开 API 映射

| 显示项 | `0.84.2` 数据源 | 结论 |
| --- | --- | --- |
| Git 分支 | `footerData.getGitBranch()`；用 `footerData.onBranchChange(callback)` 订阅变化 | 精确可实现，且无需自行轮询或执行 git |
| cwd 目录名 | `ctx.cwd` 配合 Node `path.basename()` | 精确可实现；根目录等边界应提供可读回退 |
| session 名称 | `ctx.sessionManager.getSessionName()`；监听 `session_info_changed` 刷新 | 返回 `string \| undefined`；未命名时隐藏 |
| 上下文已用量 | `ctx.getContextUsage()?.tokens` | 可实现；无用量数据时隐藏 |
| 上下文总量 | `ctx.getContextUsage()?.contextWindow` | 可实现；无用量数据时隐藏 |
| 上下文百分比 | `ctx.getContextUsage()?.percent` | 可实现；应采用 API 值而非重复计算 |
| 模型名 | `ctx.model` | 可实现；显示 `provider/id`，模型未设置时隐藏 |
| thinking level | `ctx.thinkingLevel` | 可实现；缺失时隐藏 |
| 其他扩展 status | `footerData.getExtensionStatuses()` | 可兼容，避免替换 footer 后吞掉其他扩展状态 |

来源：本机 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 的 Context 与 Custom Footer 小节；本机 `node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-footer.ts`；官方 [`custom-footer.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts)。

`ctx.ui.setFooter(factory)` 会替换内置 footer，而不是追加一段文本。factory 获得 TUI、theme 与 `footerData`，实现应返回一个遵守 TUI `Component` 契约的 footer；文本必须经 `truncateToWidth()` 控制可见宽度。主题颜色应从传入 theme 取值，不能硬编码 ANSI 色。来源：本机 `node_modules/@earendil-works/pi-coding-agent/docs/tui.md` Pattern 6，以及本机 `node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-footer.ts`。

### 1.2 刷新与资源释放

“持续刷新”不应实现为高频 timer。组件在 Pi UI 更新时会重新 render；Git 分支另有 `onBranchChange()` 明确提供变化通知，实现应在回调中调用 TUI invalidation/request-render 能力，并保存退订函数。安装新 footer 或 extension unload/会话退出时必须退订，防止 reload 后累积监听器。该模式直接来自本机 `examples/extensions/custom-footer.ts`。

上下文用量、session 名称、模型和 thinking level 在 render 时读取当前 `ctx`，因此会随 Pi 正常 UI 更新反映最新状态。session 重命名另由公开 `session_info_changed` 事件触发刷新；`0.84.2` 未提供“每个 token 都触发的 statusline tick”公开承诺，所以不能声称毫秒级或逐 token 刷新。

### 1.3 已确认视觉与窄屏策略

`@lystran/pi-statusline` 首版采用克制的图标增强，不使用装饰性图形。字段缺失即隐藏，不输出 `unknown` 占位。正常宽度建议顺序：

```text
<目录>  <session 名称>  <git 分支>  <provider/id>  <thinking>  <tokens/contextWindow percent>
```

窄屏必须保留“目录 + 上下文”；空间不足时依次隐藏其他扩展状态、session 名称、thinking level、模型和 Git 分支，最后对保留内容使用 `truncateToWidth()`。其他扩展通过 `footerData.getExtensionStatuses()` 设置的状态也必须纳入布局；其优先级不能高于本插件已确认的窄屏核心字段，但在有空间时应显示。所有组合都应过滤空字段后再添加分隔符，避免孤立图标和重复分隔线。

上下文数值使用圆形进度图标：`○`（<25%）、`◔`（25%-49%）、`◑`（50%-74%）、`◕`（75%-99%）、`●`（>=100%）。占用率严格高于 80% 时使用主题 `error` 颜色，80% 本身不触发红色警告。Git 变更使用异步 `pi.exec("git", ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z"], { cwd, timeout: 1_000 })` 缓存读取，避免同步阻塞 footer render。

### 1.4 限制与替代方案

- **中风险**：`setFooter()` 替换整个内置 footer。若只重画本插件字段，会造成内置信息和其他扩展状态回归。替代方案是以官方 custom-footer 示例为基线，并显式合并 `getExtensionStatuses()`。
- **中风险**：API 没有承诺任意状态变化立即触发单独的 footer refresh。替代方案是依赖正常 UI render，并仅对官方提供订阅的 Git 分支主动 invalidate；Git 变更在 session start、tool result 和 message end 后异步刷新，不增加同步轮询。
- **低风险**：超窄终端无法同时完整显示目录与上下文。替代方案是先省略非核心字段，再用官方 `truncateToWidth()` 保证不越界；不允许文本覆盖相邻 UI。

## 2. Serena session/tool 生命周期映射

### 2.1 Pi 可监听的相关事件

`0.84.2` 与本需求直接相关的公开事件如下：

| Pi 事件 | 已核对字段/原因 | Serena 行为 |
| --- | --- | --- |
| `session_start` | `reason` 为 `startup | reload | new | resume | fork` | 每次执行 activate |
| `tool_call` | 可检查 `event.toolName === "bash"`，并可在工具执行前拦截 | 仅模型发起的 Bash 前执行 remind |
| `session_shutdown` | `reason` 为 `quit | reload | new | resume | fork` | 仅 `quit` 执行 cleanup |

来源：本机 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 的 Session Events 与 Tool Events 小节；官方 [`docs/extensions.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)。

`tool_call` 是模型工具调用的执行前事件，因此 `event.toolName === "bash"` 可精确覆盖“每次模型 Bash 前 remind”。它不等价于监听 Pi 进程中所有 shell/子进程活动，也不应拦截扩展自己通过 `pi.exec()` 启动的 `serena-hooks`。

### 2.2 已确认命令契约

首版零配置，固定执行以下无 shell 命令，全部不带 `--client`：

```text
serena-hooks activate
serena-hooks remind
serena-hooks cleanup
```

实现使用 `pi.exec("serena-hooks", ["activate"], { timeout: 10_000 })` 等价形式。参数数组避免 shell 拼接和转义风险，10 秒 timeout 对三类命令一致。来源：本机 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 的 `pi.exec(command, args, options)` 契约；官方 [`docs/extensions.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)。

失败不得中断 session start、Bash 工具调用或退出流程。每个会话内，同一类别（activate/remind/cleanup）最多告警一次；后续同类失败保持静默，但仍按事件继续尝试命令。新 `session_start` 应重置该会话的告警去重状态。告警应包含动作类别与可操作的简短错误，不泄漏无关环境数据。

### 2.3 与目标钩子语义的差异

- **无法精确实现 `SessionStart(startup|resume)` 二值原因模型**：Pi 有五种 start 原因。只监听 `startup|resume` 会漏掉 `/reload`、new 与 fork 后的新活动会话。已确认设计选择是所有 `session_start` 都 activate，并在文档中声明这是兼容性扩展，不伪称原因一一等价。
- **无法精确实现泛化 `Stop` 事件**：`0.84.2` 没有名称或语义完全等同于外部 `Stop` 的公开 extension 事件。`session_shutdown` 还会在 reload/new/resume/fork 的会话转换中出现；这些原因执行 cleanup 可能与紧随其后的 activate 竞态或产生无意义抖动。已确认替代方案是仅 `reason === "quit"` cleanup。
- **无法保证 quit cleanup 完成**：进程被强杀、崩溃或 OS 终止时，任何进程内 shutdown handler 都可能没有执行机会。命令有 10 秒 timeout，但宿主退出行为仍是外部边界。Serena 自身应能容忍遗留状态，并在下一次 activate 时恢复。

### 2.4 风险分级

- **高风险**：在所有 `session_shutdown` 原因上 cleanup，会破坏 resume/new/fork/reload 的连续性。必须限定 `quit`。
- **高风险**：让 hook 失败返回 tool 阻断结果，会使 Serena 辅助设施故障阻止用户 Bash。必须捕获超时、非零退出和 spawn 错误并放行原工具。
- **中风险**：每次 Bash 失败都通知会造成告警风暴。必须按“会话 + 动作类别”去重。
- **中风险**：通过 shell 字符串执行会引入 PATH 之外的 shell 差异和转义面。必须使用 `pi.exec(command, args, options)`。
- **低风险**：固定零配置意味着无法自定义二进制路径和 timeout。首版这是明确产品约束；若真实用户需要再增加配置，不能提前引入未验证选项。

## 3. 入口、依赖、测试与发布契约

当前仓库 `/Users/lystran/programming/ai/pi-extensions/AGENTS.md` 已明确采用独立 workspace，而不是单根 Pi package。两个包应为：

```text
plugins/statusline/
  package.json          # name: @lystran/pi-statusline
  README.md
  src/index.ts          # pi.extensions 指向 ./src/index.ts
  test/...

plugins/serena-hooks/
  package.json          # name: @lystran/pi-serena-hooks
  README.md
  src/index.ts          # pi.extensions 指向 ./src/index.ts
  test/...
```

每个包直接发布 TypeScript 源码，`package.json` 的 `files` 包含 `src`，`engines.node` 不低于 20。Pi coding-agent 包必须同时出现在 `peerDependencies` 与 `devDependencies`：peer 声明宿主兼容范围，dev 提供本仓库类型检查和测试所需的具体版本。运行时实际导入的其他 npm 包必须放目标 workspace 自己的 `dependencies`，不得依赖根目录提升；这两个首版实现使用 Node 标准 API 与 Pi 公共 API 即可，不需要额外生产依赖。

只从 `@earendil-works/pi-coding-agent` 的公开导出导入类型/API，不引用 `dist` 或源码内部路径。生产源码必须兼容 Node.js `>=20`，不得使用 `Bun.*`、`bun:` 或 Bun 专有解析；Bun 仅用于安装、脚本和测试。来源：`/Users/lystran/programming/ai/pi-extensions/AGENTS.md`；Pi extension factory 与直接 TS 加载依据见本机 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` 和 `README.md`。

### 3.1 最小且有效的测试范围

statusline 应覆盖：

1. factory 调用 `setFooter`，并正确订阅/释放 branch change。
2. context usage 完整、缺失和边界值的格式化。
3. `provider/id`、thinking、branch、extension statuses 的缺失隐藏。
4. 多组窄宽度下的字段降级顺序，以及最终输出宽度不超过容器。
5. reload/重复初始化不会遗留 branch listener。

Serena hooks 应覆盖：

1. 五种 `session_start` reason 都调用一次 `serena-hooks activate`。
2. 仅模型 `tool_call` 且 `toolName === "bash"` 时，在 Bash 前调用 remind；其他工具不调用。
3. 仅 `session_shutdown: quit` 调 cleanup，其余四种 reason 不调用。
4. 三类命令都无 `--client`、使用参数数组并设置 `timeout: 10_000`。
5. spawn 错误、非零退出与超时均不阻断事件；每会话每类失败只警告一次，新 session 重置去重。

测试不得访问真实网络、调用真实模型或依赖真实 `serena-hooks`。用受类型约束的 fake `ExtensionAPI` 捕获事件注册与 `pi.exec` 参数；对 footer 使用最小 fake TUI/footerData 验证渲染和退订。完成后按仓库要求运行 `bun run verify`。发布行为变化需运行 `bun changeset`，选择实际受影响 workspace 和正确 semver；发布前还需从 npm tarball 执行真实 `pi install` 冒烟验证。来源：`/Users/lystran/programming/ai/pi-extensions/AGENTS.md`。

## 4. 对现有研究文档的审阅发现

- **高**：`/Users/lystran/programming/ai/pi-extensions/docs/research/pi-extension-development.md` 的“采用单根 package，不立即上 workspace”结论已被当前根 `package.json` 的 `workspaces: ["plugins/*", "packages/*"]` 和 `/Users/lystran/programming/ai/pi-extensions/AGENTS.md` 明确取代。后续实现不得沿用其目录建议；应将其视为历史调研，或单独修订并标注失效。
- **中**：该文档以 `@mariozechner/pi-coding-agent` 为主要包名，而本机实际核对版本是 `@earendil-works/pi-coding-agent@0.84.2`。涉及 imports、peer dependency 和本机 API 验证时必须使用实际 fork 包名与版本；上游官方文件只用于交叉参考。
- **中**：该文档没有覆盖 custom footer 替换内置 footer后的 extension status 兼容责任，也没有给出 session reason 到 Serena 行为的精确映射。本专项报告补足了这两个实现风险。

本任务仅调研并写文档，不修改任何插件源码，也不修改旧研究文件。

## 5. 实施规格汇总

### `@lystran/pi-statusline`

- 入口固定 `plugins/statusline/src/index.ts`。
- `ctx.ui.setFooter()` 安装自定义 footer。
- Git 使用 `footerData.getGitBranch()` + `onBranchChange()`，保存并调用退订函数。
- cwd 用 `path.basename(ctx.cwd)`；session 名称用 `ctx.sessionManager.getSessionName()`，未设置时隐藏，并监听 `session_info_changed` 刷新；context 用 `tokens/contextWindow/percent`；模型显示 `provider/id`；thinking 用 `ctx.thinkingLevel`。
- 图标增强但克制，缺失项隐藏。
- 窄屏始终优先目录、分支、紧凑 Git 变更和上下文；其他扩展状态及第二行 MCP 状态在空间不足时隐藏，最终统一 `truncateToWidth()`。
- 合并 `footerData.getExtensionStatuses()`，不能吞掉其他扩展状态；`pi-mcp-adapter` 的固定 status key `mcp` 将其 `🔌 MCP:` 前缀替换为 `󰒍 MCP:`，与累计 session token 统计一起放在第二行，保留状态文本和 ANSI 主题颜色。
- 第二行 token 统计遍历公开 `ctx.sessionManager.getEntries()`，累计 assistant、tool result、compaction 和 branch summary 的 usage；输入显示 `↓`，输出显示 `↑`，使用 `K/M` 单位。Pi 原生 `R` 表示累计缓存读取 token，`W` 表示缓存写入 token，`CH` 表示最近一次模型请求的缓存命中率 `cacheRead / (input + cacheRead + cacheWrite)`。
- Git 变更通过异步 `pi.exec()` 读取 porcelain 状态：未追踪显示蓝色 `!n`，未暂存工作区变更显示橙色 `!n`，暂存区变更显示橙色 `+n`；三个计数合并为无空格紧凑字段，分支使用绿色。

### `@lystran/pi-serena-hooks`

- 入口固定 `plugins/serena-hooks/src/index.ts`。
- 每个 `session_start` reason 均执行 `serena-hooks activate`。
- 每次模型 Bash 的 `tool_call` 执行前运行 `serena-hooks remind`。
- 仅 `session_shutdown.reason === "quit"` 运行 `serena-hooks cleanup`。
- 全部通过 `pi.exec("serena-hooks", [action], { timeout: 10_000 })`，不带 `--client`。
- 失败永不阻断宿主流程；每会话每类失败至多警告一次。
- 首版零配置。

## 残余风险

1. 本机文档和示例证明了 `0.84.2` 的公共使用模式，但发布前仍需以目标 workspace 实际安装的 `.d.ts` 通过严格类型检查，避免 fork 与上游同名文档的细微签名差异。
2. 自定义 footer 的刷新频率受 Pi UI 生命周期约束；除 Git 分支订阅外，没有逐 token 立即刷新的公开保证。
3. `quit` cleanup 无法覆盖强杀、崩溃和宿主来不及等待异步 handler 的情形。
4. statusline 替换内置 footer 后，未来 Pi 新增的内置 footer 字段不会自动继承；升级 Pi 时需复查官方 `custom-footer.ts`。
5. 旧报告仍保留过时的单根 package 建议，在其被修订前可能误导后续实现者；本报告与 `AGENTS.md` 应优先。

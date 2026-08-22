# 调研：destructive_command_guard 集成 Pi 权限插件

> 输出路径：`/Users/lystran/programming/ai/pi-extensions/research.md`
>
> 调研基线：仓库当前 `bun.lock` 锁定 `@earendil-works/pi-coding-agent@0.84.2`，其 peer 约束为 `>=0.84.2`（本机路径：`/Users/lystran/programming/ai/pi-extensions/bun.lock`）。Pi 的 upstream 仓库目前已继续演进，因此实现前应以本机安装版本的公开声明和测试为最终依据。

## 结论摘要

推荐实现一个 Pi extension，在 `tool_call` 事件中只拦截 `bash` 工具，取出 `event.input.command`，调用已安装的 `dcg` 子进程进行判定。DCG 的“拒绝”模式直接返回 Pi 的 `{ block: true, reason }`；“询问”模式只对 DCG 判定危险的命令调用 `ctx.ui.confirm()`，确认后放行，否则返回 block。必须把 DCG 作为策略引擎而不是在 TypeScript 中复制规则，并把调用失败视为拒绝（fail closed），否则 guard 本身故障会变成绕过点。

Pi 有准确的执行前拦截和 UI 确认 API，但截至当前公开 API 没有稳定的 `pi.settings.register/get` 扩展设置接口；该能力仍是提案。因此配置应先使用独立 JSON 配置文件或命令行 flag，扩展可用 `pi.registerCommand()` 提供 reload/status/config 命令；若写入 Pi 会话状态，则使用公开的 `pi.appendEntry()`，但它不是全局配置持久化。

## 1. DCG CLI/API

### 1.1 定位、输入和安装

1. **工具定位** — DCG 是用于阻止 agent 执行危险 git 和 shell 命令的 Rust CLI/本地 hook 工具。官方仓库 README：[destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard)。
2. **安装方式** — 官方 README 提供安装脚本，典型方式为：

   ```sh
   curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main/install.sh?$(date +%s)" | bash -s -- --easy-mode
   ```

   脚本下载适合平台的预编译 binary；也应记录安装后的 binary 路径并在 Pi 配置中支持显式 `dcgPath`。来源：[官方仓库搜索摘要](https://github.com/Dicklesworthstone/destructive_command_guard)。
3. **Hook 输入** — 官方仓库说明 DCG 可接入 Claude/Codex 等 agent hook；Codex 集成文档显示它处理命令执行前的结构化 hook 输入，并在拒绝时输出最小 JSON。来源：[docs/codex-integration.md](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/docs/codex-integration.md)。
4. **Pi 集成时的输入适配风险** — Pi 的 `bash` tool 通过 `tool_call` 事件暴露结构化参数；不要把完整事件 JSON 盲目传给 DCG，也不要假定 Claude/Codex hook schema 与 Pi 相同。应先阅读锁定版本 DCG CLI 的 `--help`、README 和其 hook 输入解析源码，建立明确 adapter；若当前 DCG 只接受某一宿主 hook envelope，应在 adapter 中生成该 envelope。

### 1.2 判定、输出和退出码

1. **判定链路** — DCG 官方研究资料描述的热路径为 parse → quick reject → normalize → safe patterns → destructive patterns → output formatting。来源：[RESEARCH_FINDINGS.md](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/RESEARCH_FINDINGS.md)。
2. **拒绝输出** — Codex 文档明确提到 denial 使用最小 JSON 输出，并且真实 Codex 集成测试检查日志中有 `hook: PreToolUse Blocked`；因此 adapter 应优先解析结构化 stdout/stderr，而不是只依赖文本匹配。来源：[docs/codex-integration.md](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/docs/codex-integration.md)。
3. **退出码限制** — 官方材料可确认“hook 拒绝”是可观测结果，但当前可访问的 README 摘要没有给出足够可靠的完整退出码表。实现前必须针对锁定 DCG 版本运行 `dcg --help`、安全命令、拒绝命令和无效输入，并把退出码映射写成测试；不能把常见的 `0/1/2` hook 约定当成 DCG 已确认契约。残余风险见下文。
4. **API 形态** — DCG 的稳定集成面是 CLI/hook，而不是已发布的 Node API。Pi 插件应通过 `node:child_process` 的 `execFile`/`spawn` 调用 binary，设置超时、限制 stdout/stderr 大小，并使用 argv 传参，绝不能把待检查命令拼到 shell 字符串中执行。

### 1.3 规则、限制和许可证

1. **默认规则包** — 无配置文件时，DCG 默认启用最严重、不可恢复错误的规则：`core.filesystem`（危险递归 rm 及等价文件系统破坏，always-on、不可禁用）和 `core.git`（丢失未提交工作、重写历史、销毁 stash 的 destructive git 命令，always-on、不可禁用）。来源：[官方仓库 README 搜索摘要](https://github.com/Dicklesworthstone/destructive_command_guard)。
2. **规则模型** — 官方源码/研究资料显示规则按 pack/rule 组织，并经过规范化和快速拒绝门；规则可能跨 shell 片段分析。不要仅在插件里实现 `rm -rf`、`git reset --hard` 等正则，因为别名、引号、管道、换行、shell 语法和组合命令会绕过简化匹配。来源：[RESEARCH_FINDINGS.md](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/RESEARCH_FINDINGS.md) 与仓库 issue [#302](https://github.com/Dicklesworthstone/destructive_command_guard/issues/302)。
3. **限制** — DCG 规则覆盖面不是 shell 权限沙箱；官方 issue 明确存在特定 shell/平台 hook 不生效的情况，例如 Windows Codex hook 安装成功但执行路径仍未阻断。来源：[issue #125](https://github.com/Dicklesworthstone/destructive_command_guard/issues/125)。它也不能防止 shell 内部解释器、动态下载、程序自身漏洞或未覆盖的 destructive 语义。
4. **自我修复风险** — 官方研究指出其设置自修复存在并发写入/非原子写风险。Pi 插件不应让每一次 `tool_call` 触发 DCG 配置自修复；安装和配置更新应是显式、串行、可审计操作。来源：[issue #292](https://github.com/Dicklesworthstone/destructive_command_guard/issues/292)。
5. **许可证** — 官方仓库 README badge 标示 `MIT+OpenAI/Anthropic Rider`，许可证文件应在发布集成前逐字核对：[LICENSE](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/LICENSE)。这不是普通 MIT-only 结论；Rider 的适用范围、再分发和模型训练条款必须由发布者审核。

## 2. Pi 公开扩展 API

### 2.1 执行前拦截

1. **事件和返回值** — 公开扩展示例注册 `pi.on("tool_call", async (event) => ...)`；返回 `{ block: true, reason: "..." }` 会阻止工具执行。来源：[官方 `06-extensions.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts)。
2. **精确定位** — `tool_call` 是工具执行前的 gate；官方 issue 描述其进入 `prepareToolCall()`，被阻断时不会调用实际 tool execute。来源：[issue #2543](https://github.com/earendil-works/pi/issues/2543)。
3. **工具类型收窄** — 使用官方导出的 `isToolCallEventType("bash", event)`（本机版本若声明存在）再读取 `event.input.command`，不要用未类型化的 `event.params` 或假定所有工具都有 command。Pi 官方 release 记录了 `ToolCallEvent.input` 和该 type guard：[v0.51.0](https://github.com/earendil-works/pi/releases/tag/v0.51.0)。本机最终证据应核对 `node_modules/@earendil-works/pi-coding-agent` 的 `dist`/声明以及当前仓库插件 import 风格。
4. **覆盖范围** — 只拦截 `bash` 只能覆盖 Pi 内置 shell 工具。其他扩展注册的自定义工具、用户直接输入的 shell、外部 RPC/SDK 调用不自动经过该 guard；需要把安全边界定义为“Pi agent tool calls”，而不是操作系统权限。

### 2.2 询问确认

1. **交互确认** — `tool_call` handler 可调用 `ctx.ui.confirm(title, ...)`；官方 issue 给出了确认模式示例，并在拒绝时返回 block 或调用 `ctx.abort()`。来源：[issue #4276](https://github.com/earendil-works/pi/issues/4276)。`ctx.ui.select()` 适合多选项，但本需求只有 allow/deny，优先 confirm。
2. **非交互模式** — 检查 `ctx.hasUI`。没有 UI（RPC、print、测试、无头 SDK）时不能等待确认；建议按配置 `headlessPolicy: "deny"` 默认拒绝，除非明确配置为 allow。Pi 的扩展 UI/RPC 文档索引：[docs/index.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md)。
3. **取消语义** — 用户取消或超时应视为拒绝；不要把 `undefined` 当作 allow。`ctx.abort()` 会停止当前 agent run，但单纯拒绝本次危险 tool 通常更适合返回 `{ block: true, reason }`，以便模型收到原因并继续安全工作。Pi 官方 changelog 记录了 `terminate` 等版本变化，故不要依赖未锁版本的内部 abort 行为：[CHANGELOG.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)。

### 2.3 配置持久化

1. **扩展加载配置** — Pi 全局设置位于 `~/.pi/agent/settings.json`，项目设置位于 `/.pi/settings.json`，其中 `extensions` 数组控制加载；来源：[官方 settings 文档相关变更](https://github.com/earendil-works/pi/issues/645)。
2. **当前公开 API 的边界** — `pi.appendEntry(customType, data?)` 是会话扩展状态持久化，写入 session JSONL，不等同于全局/项目 settings。来源：[Pi v0.31.0 release](https://github.com/earendil-works/pi/releases/tag/v0.31.0)。
3. **没有确认的 typed settings API** — `pi.settings.register/get` 目前是公开 issue 中的提案，不应作为现有 API 依赖。来源：[issue #4981](https://github.com/earendil-works/pi/issues/4981)。因此最小实现应：从显式 `DCG_CONFIG`/扩展专用 JSON 读取配置；通过 `pi.registerCommand("dcg", ...)` 提供 status/reload；需要改变 Pi settings 时让用户编辑 `settings.json` 或通过受控 CLI，不在每次 hook 中无锁改写。
4. **命令和 flag** — `pi.registerCommand()` 是公开扩展 API；扩展也可注册 flag，但 flag 在启动时解析，新增 flag 通常需重启。来源：[官方 `06-extensions.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts) 和 [v0.31.0](https://github.com/earendil-works/pi/releases/tag/v0.31.0)。

## 3. 推荐最小架构

```text
Pi tool_call(bash)
  -> input.command 校验（字符串、长度上限）
  -> DCG adapter（execFile，固定 argv，超时/输出上限）
  -> Decision { safe | dangerous(reason, rule) | unavailable(error) }
  -> mode=deny: block dangerous/unavailable
  -> mode=confirm: ctx.hasUI && ctx.ui.confirm；否则 headlessPolicy
  -> allow: return undefined
  -> deny: { block: true, reason }
```

建议模块边界：

- `config.ts`：默认 `mode: "deny"`、`headlessPolicy: "deny"`、`timeoutMs`、`dcgPath`、可选工作目录；校验 JSON，未知字段拒绝或告警
- `dcg-client.ts`：唯一负责子进程协议、退出码表、JSON 解析、超时和错误映射
- `policy.ts`：把 DCG 结果和 mode/headlessPolicy 映射为 allow/confirm/block
- `index.ts`：注册 `tool_call` 与 `dcg` command；不包含规则正则
- `test/`：使用 fake dcg executable，禁止真实网络、真实 destructive command 和真实用户目录

安全默认值：DCG binary 缺失、非零但无法识别、超时、JSON 无效、输出截断、确认取消，全部 deny；reason 中不要回显敏感环境变量或完整命令输出，可显示规范化命令摘要与 rule id。确认前应显示完整命令或经过明确截断的版本，避免用户批准了看不清的内容。

## 4. 风险、测试边界和兼容性

### 风险

- **P0 绕过风险** — 调用 DCG 的 envelope/退出码映射错误会让危险命令被放行；必须锁定 DCG 版本并做契约测试
- **P1 覆盖不足** — 只覆盖 `bash` tool，不覆盖自定义工具、直接 shell、外部进程和 OS 层；文档必须明确
- **P1 UI 阻塞** — 无头模式调用 `ctx.ui.confirm` 会挂起或失败；用 `ctx.hasUI` 分支并默认 deny
- **P1 竞态/性能** — 每个 bash call 启动进程；设置超时并测量延迟，必要时后续增加长期 worker，但不要一开始引入复杂 daemon
- **P2 版本漂移** — 当前锁定 Pi `0.84.2`，upstream 已有 tool event、terminate 和 UI 行为变更；peer range 应按实际声明和回归测试收紧
- **P2 配置安全** — 配置文件可被 agent 修改；配置目录权限、加载位置和启动时快照要记录，不能把“可写配置”当成强制权限边界

### 最小测试矩阵

1. adapter：safe、dangerous、每种已确认拒绝退出码、未知退出码、无效 JSON、空 stdout、超时、binary missing、超长输出
2. policy：deny 模式 dangerous/unavailable 都 block；confirm 模式 UI allow 放行、deny/cancel block；headless 默认 block
3. Pi hook：非 bash 忽略；bash 的 `command` 正确读取；handler 返回 reason；同一 assistant response 的并行 tool calls 不会因一次确认错误地放行其他命令
4. DCG 规则回归：递归 rm、危险 git reset/clean、stash/history 破坏、管道/换行/引号/多段命令；safe temp path 和普通 git 命令不得误阻断。测试只把字符串交给 fake/真实 DCG evaluator，不执行命令
5. 发布冒烟：从 npm tarball 安装，`pi install -l .`，确认 `/reload` 后 hook 仍注册；TUI、RPC/无头和 `--no-session` 场景分别验证

### 兼容性判断

- 最低基线应先按本机 `@earendil-works/pi-coding-agent@0.84.2` 实测，而不是直接承诺 upstream `main`
- 依赖的公开符号仅限 `ExtensionAPI`、`pi.on("tool_call")`、`isToolCallEventType`（若本机声明导出）、`ctx.ui.confirm`、`ctx.hasUI`、`pi.registerCommand`、`pi.appendEntry`
- 不依赖 `dist` 内部 runner、agent-loop、TUI component 或私有 SettingsManager；本机源码/声明路径应在实现审查时记录为 `node_modules/@earendil-works/pi-coding-agent/dist/...`，并以 package exports 允许的公开入口为准

## 来源清单

- [DCG 官方仓库 README](https://github.com/Dicklesworthstone/destructive_command_guard) — CLI 定位、安装、默认规则
- [DCG Codex 集成](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/docs/codex-integration.md) — hook 输入/输出及真实阻断测试
- [DCG 研究资料](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/RESEARCH_FINDINGS.md) — evaluator 热路径和已知工程风险
- [DCG LICENSE](https://github.com/Dicklesworthstone/destructive_command_guard/blob/main/LICENSE) — 许可证原文，应在发布前复核
- [Pi 官方扩展示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts) — `tool_call`、`registerCommand`、custom tool API
- [Pi tool call block issue](https://github.com/earendil-works/pi/issues/2543) — 执行前 gate 的行为
- [Pi confirmation/abort issue](https://github.com/earendil-works/pi/issues/4276) — `ctx.ui.confirm`、`ctx.abort` 示例和边界
- [Pi v0.51.0](https://github.com/earendil-works/pi/releases/tag/v0.51.0) — typed tool-call event/type guard
- [Pi v0.31.0](https://github.com/earendil-works/pi/releases/tag/v0.31.0) — `appendEntry` 与会话状态持久化
- [Pi settings/package loading](https://github.com/earendil-works/pi/issues/645) — settings 路径和扩展加载
- [Pi typed settings proposal](https://github.com/earendil-works/pi/issues/4981) — 证明 `pi.settings.register/get` 尚非可依赖现有 API
- 本机锁定依赖：`/Users/lystran/programming/ai/pi-extensions/bun.lock` — Pi `0.84.2` 与 peer 约束
- 本机研究技能：`/Users/lystran/programming/ai/pi-extensions/.pi/skills/research/SKILL.md` — 研究方法与报告要求

## 未解决问题

1. DCG 当前 release 的完整 CLI 子命令、参数名、输入 envelope、逐个退出码和 JSON schema 未能从搜索索引可靠取得；实现前必须在锁定 commit 上读取 README、`--help`、CLI parser 和 hook integration tests，并把结果补入 adapter contract
2. DCG 的 `MIT+OpenAI/Anthropic Rider` 不是普通 MIT-only 许可，商业发布前需要法律审核
3. Pi `0.84.2` 的实际 `isToolCallEventType` export 和 `event.input` 字段应从本机 package exports/声明确认；若缺失则使用公开基础 `event.toolName` 加类型判断，并添加本机版本编译测试

## Acceptance

- **review-findings**：未修改生产代码；研究结论中的主要阻断风险是 DCG CLI 退出码/envelope 尚未锁定，以及 Pi 版本漂移
- **residual-risks**：DCG 协议细节、许可证 Rider、Pi 本机导出仍需实现前验证

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "报告已写入 /Users/lystran/programming/ai/pi-extensions/research.md，包含 DCG CLI/API、Pi tool_call/confirm/持久化 API、推荐架构、风险、测试和版本兼容性，并为事实提供官方链接或本机路径"
    }
  ],
  "changedFiles": [
    "/Users/lystran/programming/ai/pi-extensions/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "已读取并遵循 .pi/skills/research/SKILL.md",
    "仅创建调研报告，未修改生产代码"
  ],
  "residualRisks": [
    "DCG 当前版本完整退出码和 hook envelope 需要在实现前通过锁定 binary/源码补证",
    "DCG MIT+OpenAI/Anthropic Rider 需要许可证审核",
    "Pi 0.84.2 的具体公开 export 需要本机 TypeScript 编译确认"
  ],
  "noStagedFiles": true,
  "diffSummary": "新增 destructive_command_guard 与 Pi 权限插件集成调研报告",
  "reviewFindings": [
    "blocker: 实现前必须锁定 DCG CLI 输入 envelope 与退出码映射，否则存在危险命令放行风险",
    "high: Pi hook 只覆盖 bash tool，不是操作系统级权限边界"
  ],
  "manualNotes": "运行时指定的权威输出路径为 research.md；用户请求中的 docs/research/destructive-command-guard-pi-permission.md 未写入，以遵守运行时路径覆盖"
}
```

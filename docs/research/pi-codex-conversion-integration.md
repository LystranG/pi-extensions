# Pi Codex Conversion 与 Pi Guard 集成调研

> 调研对象：`@howaboua/pi-codex-conversion`，仓库 `IgorWarzocha/howaboua-pi-stuff`
>
> 目标版本：Pi coding agent 0.84.2 的公开扩展 API
>
> 事实来源优先级：插件仓库源码/README/提交记录 > Pi 官方扩展文档与 changelog > dcg 官方仓库
>
> 说明：当前运行环境无法直接访问 GitHub raw/API，也没有可用的本机 shell 列目录工具。因此源码层面的结论引用了 GitHub 的源码目录索引、README 和提交记录；精确 schema 名称应在实现前从本机 checkout/tarball 再核对。没有把搜索摘要当成已读取的源码正文。

## 摘要

插件的默认 Structured adapter 将 Pi 的 `read`/`edit`/`write`/`bash` 工具面替换为 Codex 风格的 `exec_command`、`write_stdin`、`apply_patch`，并按能力额外注册 `view_image`、`web_run`、`imagegen`；它还注册 `/codex` 及其子命令用于设置。Code Mode 的 provider-visible 工具只有 `exec`/`wait`，嵌套 shell、patch、web 等操作在本地 Code Mode host 中组合执行。由此，单纯监听 Pi 的 `tool_call` 且只处理 `toolName === "bash"` 无法覆盖该插件的 shell 路径。

Pi Guard 应把 `exec_command` 和 Code Mode 的 `exec`/`wait` 作为一等拦截目标，并在 `tool_call` 阶段从对应输入中提取命令；可复用 dcg 的无执行 preflight/robot JSON 接口，但不能假设 dcg 的一次检查能解析 PTY 后续输入、Code Mode 中任意 JavaScript 或自定义命令。最小可靠实现是：覆盖结构化 `exec_command`，覆盖 `write_stdin` 的非空 `chars`，覆盖 `exec` 的可静态提取命令；对无法静态提取的 Code Mode 请求 fail-closed 或显式降级。

## 1. 插件注册面

### 1.1 自定义工具

README 明确列出以下 Codex-shaped 工具（仓库路径：`packages/pi-codex-conversion/README.md`，源码入口：`packages/pi-codex-conversion/src/index.ts`，源码子目录：`src/tools/`、`src/shell/`、`src/patch/`）：

| 工具 | 作用与输入形态 | 输出/执行语义 | 证据与置信度 |
| --- | --- | --- | --- |
| `exec_command` | Codex 风格 shell 请求，至少包含命令字符串 `cmd`；README 示例使用 `yield_time_ms`，长任务返回 `session_id` | 运行前台/后台/PTY shell；结果含文本内容，通常包含可继续轮询的 session id；实现使用自定义 PTY/原生 helper | README + `src/tools/`、`src/shell/` 索引；高置信度，精确可选字段需读 schema |
| `write_stdin` | `session_id`、`chars`（可为空用于 poll），README 示例为 `write_stdin({session_id, chars: ""})` | 向已运行 shell 写入 stdin 或轮询输出；可能继续执行 shell 内的后续命令 | README/npm 描述；高置信度 |
| `apply_patch` | Codex patch 文本/patch block；README 说明默认使用 patch 编辑 | 修改工作区，路径策略限制在当前 cwd；输出 Added/Edited/Deleted 风格 diff 结果 | README、源码 `src/patch/`、旧实现说明；高置信度 |
| `view_image` | 本地图片路径，支持图像模型时启用；路径按 session cwd 解析 | 图片内容/错误结果，不是 shell | README 与旧 adapter 文档；高置信度 |
| `web_run` | web/page navigation 请求，插件内部调用 Responses/web 能力或 helper | web 结果/错误；不是 shell | README；中高置信度 |
| `imagegen` | 图像生成/编辑请求 | 图片结果/路径或错误 | README；中高置信度 |

Structured mode 没有独立的 `read`、`edit`、`write`；模型通过 `exec_command` 检查文件，编辑用 `apply_patch`。README 还描述了 Extra tools only 模式：可以只额外启用 `apply_patch`、`view_image`、`web_run`、`imagegen`，而不替换当前 Pi 工具。

### 1.2 Code Mode 工具

README 的 Code Mode 章节明确：provider 侧只暴露 `exec` 与 `wait`；shell、patch、image、web 和 custom tools 在 `exec` 内本地组合。也就是说，Pi 的外层 `tool_call` 通常看到的是 `exec` 或 `wait`，而不会看到嵌套的 `bash`、`exec_command`、`apply_patch` 等独立事件。Code Mode 还可加载 top-level TOML custom tools，每个定义的 `command` 接受一个字符串，具体目录为 `~/.pi/agent/codex-conversion-custom-tools/` 或受信任项目目录（README/npm 文档）。

### 1.3 命令

插件注册 `/codex` 设置入口；README 明确支持 `/codex tools`、`openai`、`display`、`voice`、`usage`、`about` 等 tab 路由，以及 `/codex all`、`/codex fast`、`/codex compact`、`/codex usage`、`/codex reset`、`/codex low|medium|high`、`/codex ps` 等快捷命令。设置持久化到 `~/.pi/agent/pi-codex-conversion.json`，受信任项目可用 `.pi/pi-codex-conversion.json`。

## 2. 是否使用 Pi `bash`，以及绕过 `tool_call` bash 的路径

**结论：默认 Codex adapter 不依赖 Pi 内置 `bash` 工具。** 它通过自定义 `exec_command`/`write_stdin` 以及 bundled Rust/native helper、PTY/session manager 执行 shell。README 的 Structured adapter 描述也明确是“replaces Pi's default file and shell tools”。因此 Guard 只监听 `bash` 的代码不会触发。

可能绕过 `tool_call` bash 的路径：

1. **Structured `exec_command`**：Pi 事件是 `tool_call`，但 `toolName` 是 `exec_command`，命令在 `input.cmd` 或兼容字段中。
2. **`write_stdin`**：首次命令已经在 exec 中启动；后续 `chars` 可以给 shell 输入新的命令/控制字符，事件名是 `write_stdin`，不是 `bash`。
3. **Code Mode `exec`**：外层事件只有 `exec`；任意嵌套 shell/custom command 可在 provider host 中执行。插件 README/npm 文档明确嵌套工具本地执行且不把这些 schema 暴露给 provider。
4. **PATH/自定义 helper/native binary**：当前版本已移除旧 PATH mode，但 bundled Rust helper 和 `tools.customRustBinariesDir` 仍是执行边界。Guard 若只拦工具事件，无法证明 helper 内部不会再派生 shell。
5. **原生 Responses web/image 路径**：`web_run`/`imagegen` 以及原生 web search 不是 shell，不能误判为 bash；但它们可能产生网络或文件副作用，需另设策略。

Pi 官方扩展文档定义 `tool_call` 为“执行前，可 block”，事件包含 `toolName`、`toolCallId`、`input`；同一文档也有独立的 `user_bash` 事件。Pi 0.84.2 changelog 记录了 direct RPC bash 曾绕过 `user_bash` 的修复，说明 `user_bash` 与 `tool_call` 不是可互换的安全边界。Guard 应把 `tool_call` 作为 agent 工具拦截主路径，同时按需要监听 `user_bash` 以覆盖用户输入的 `!`/`!!` bash。

## 3. Pi Guard 兼容方式与 dcg

### 3.1 事件匹配

Pi 公开扩展文档（`https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`）给出的模式是：

```ts
pi.on("tool_call", async (event) => {
  if (event.toolName === "bash") {
    // event.input.command
    return { block: true, reason: "..." };
  }
});
```

0.84.x 类型声明已将内置 `BashToolCallEvent.input` 定义为 `{ command: string; timeout?: number }`，自定义工具则为 `Record<string, unknown>`，并提供 `isToolCallEventType` 类型守卫。对本插件 Guard 不应直接把所有输入都 cast 成 bash；应按工具名使用自定义 extractor：

- `bash`: `input.command`
- `exec_command`: 优先 `input.cmd`，兼容检查 `input.command`，只接受 string
- `write_stdin`: 仅当 `chars` 非空时作为 shell stdin 候选；没有可靠的 shell command 语义时标记为 `interactive-input`
- `exec`: 解析其 Code Mode 输入，仅在确定得到 shell call 时检查；任意 JavaScript 动态拼接、变量、循环或 custom tool 应标记 `uninspectable`

### 3.2 复用 dcg `--robot test`

可复用 dcg 的“只检查、不执行”模式，前提是本机安装版本确实提供该 flag。dcg 官方 README 说明它作为 shell command 的 PreToolUse guard 接收 JSON stdin；相关 robot/preflight 资料显示当前生态常见接口是 `dcg --robot test` 或包装器 `--robot-dcg-check --command=...`，输出 JSON allow/deny/reason。可采用子进程 `execFile("dcg", ["--robot", "test"], { input: JSON.stringify(...) })`，但必须以本机 `dcg --help` 和安装版本测试为准，不能把 `ntm --robot-dcg-check` 当作 dcg 原生接口。

复用边界：

- 对 `bash.command` / `exec_command.cmd`：可以直接传完整 shell command，保留 cwd/环境元数据（若 dcg schema 支持）。
- 对 `write_stdin.chars`：只能在策略上把输入当作潜在 shell command；PTY 状态、shell quoting、当前目录和 alias 未必可重建，结果应标为近似检查。
- 对 Code Mode：只有静态识别的字符串 shell call 才能交给 dcg；动态 JS、下载并运行的 custom tool、原生 helper 内部命令不能靠正则安全提取。无法提取时应阻止、请求确认或让 Code Mode host 提供“每个嵌套 shell call 先回调 Guard”的协议。
- dcg 只判断 shell command；它不覆盖 `apply_patch` 路径越界、图片/web 网络外泄、custom helper 下载、TTY 控制序列等其他边界。

## 4. 安全边界与版本兼容风险

| 严重度 | 风险 | 证据/影响 |
| --- | --- | --- |
| 高 | Guard 只处理 Pi `bash` 会漏掉 `exec_command` 与 Code Mode `exec` | 插件 README 的工具替换与 Code Mode nested-local 语义；shell 实际执行不在 bash 事件中 |
| 高 | Code Mode 动态 JS/custom command 无法可靠提取最终 shell command | README 说明只把 `exec`/`wait` 暴露给 provider，嵌套能力在本地 host 组合；静态文本扫描会被变量、拼接、编码、间接调用绕过 |
| 高 | `write_stdin` 可在初次检查后继续给 PTY 注入输入 | `write_stdin` 的 `chars`/resumable session 语义；一次 allow 不等于整个 session 后续输入安全 |
| 中高 | native helper/custom binary 是额外信任根 | README 允许 `tools.customRustBinariesDir` 覆盖 helper；恶意/错误 binary 可完全绕过上层命令策略 |
| 中 | 路径/cwd 不一致导致 dcg 检查对象与实际执行对象不同 | 项目设置只在 trusted folders 读取；命令执行 cwd、session cwd、Guard cwd 必须统一 |
| 中 | Pi API 版本漂移 | 插件 README 要求 Pi >=0.82、Node >=22.19；仓库任务目标是 Pi 0.84.2。`tool_call` 事件 typing、termination、RPC bash 修复均在近期变更，需锁定公开类型并做版本矩阵 |
| 中 | 包版本与 README/index 漂移 | npm 搜索结果显示 3.0.15/3.0.18 等不同时间版本；应固定 commit 或 tarball hash，不能仅按 `main` 结论发布 |
| 中 | dcg CLI/JSON schema 漂移或未安装 | dcg 缺失、旧版本、不兼容 flag 必须 fail closed 或显式告警；不能把“dcg 不可用”当作 allow |
| 低中 | 原生 web/image/voice/remote UI 的网络和文件副作用未纳入 shell guard | README 明确这些额外能力；它们不是 shell，但仍可能产生数据外传或持久化副作用 |

## 5. 最小实现建议

1. 注册单一 `tool_call` Guard，先做严格工具白名单：`bash`、`exec_command`、`write_stdin`、`exec`、以及已知 Code Mode custom tool 名称。
2. 抽取器返回结构化结果：`{ kind: "shell", command, cwd, source }`、`{ kind: "interactive-input", text, source }`、`{ kind: "uninspectable", reason, source }`、`{ kind: "non-shell" }`。
3. `shell` 直接调用 dcg preflight；deny 返回 `{ block: true, reason }`。dcg 缺失/解析失败默认 block 或进入明确的人工确认模式。
4. `interactive-input` 默认 block，除非能证明是无害控制/轮询；不要把任意非空 `chars` 当作已审查命令。
5. `uninspectable` 的 Code Mode 请求默认 block；更好的长期接口是让 Code Mode host 在每次嵌套 shell 前调用 Guard，而非让 Guard 反解析 JavaScript。
6. 记录 `toolCallId`、工具名、原始 input 摘要、提取命令 hash、cwd、dcg 结果；避免记录 secrets 和完整环境变量。
7. 单独实现 patch 路径策略、web/image 网络策略和 native helper 完整性校验，不把 dcg 当作全局沙箱。
8. 以 Pi 0.84.2 本机公开 `.d.ts` 为编译基线，并对 0.82、0.84.2、当前最新版本做 smoke；运行时检查 `pi.getActiveTools()` 以适应其它扩展改变工具面。

## 6. 测试矩阵

| 维度 | 必测案例 | 预期 |
| --- | --- | --- |
| Pi 工具 | `bash.command` safe/danger/空值/非字符串 | dcg allow、block、输入错误分别稳定处理 |
| Codex adapter | `exec_command.cmd` 短命令、长命令、yield/session 返回 | 命令被检查一次且结果不改变 session 语义 |
| 交互 shell | `write_stdin.chars=""` poll、普通 stdin、`rm -rf...\n` | poll 放行；无法证明安全的输入阻止/确认 |
| Code Mode | 静态 `exec("rm -rf /tmp")`、字符串拼接、变量、循环、custom tool | 静态命令送 dcg；不可提取请求 fail-closed |
| 并发 | parallel 多个 shell call、一个 batch 中 deny | 每个 toolCallId 独立判定；不因 batch 顺序漏检 |
| 事件路径 | agent tool call、RPC tool call、用户 `!`/`!!` bash | `tool_call`/`user_bash` 覆盖范围符合预期；回归测试 direct RPC |
| 环境 | cwd 变更、trusted/untrusted project、Windows/macOS/Linux | Guard cwd 与实际 cwd 一致；平台命令行编码稳定 |
| dcg | 已安装 allow/block、缺失、旧版本、超时、坏 JSON | 不可用不静默放行，错误可诊断 |
| 非 shell | `apply_patch` 越界、`view_image`、`web_run`、`imagegen` | 分别走路径/网络策略，不误交给 dcg |
| 版本 | Pi 0.82、0.84.2、最新；插件 3.0.x 固定 tarball | 类型、工具激活、termination、RPC 行为无回归 |
| 输出 | 长输出截断、ANSI/PTY 重绘、secret redaction | Guard 日志不泄密，工具结果仍可恢复/轮询 |

## 来源

### 保留

- 插件 README/源码索引：<https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion> — 工具面、模式、命令、配置和运行时说明
- 插件源码目录：<https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion/src> — `index.ts`、`tools/`、`shell/`、`patch/` 等实现边界
- Pi 官方扩展文档：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md> — `registerTool`、`registerCommand`、`tool_call`、`user_bash` 和结果结构
- Pi 0.84.2 changelog：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md> — tool event termination、direct RPC bash 修复及版本行为
- dcg 官方仓库：<https://github.com/Dicklesworthstone/destructive_command_guard> — PreToolUse shell guard 的职责和 robot 接口背景
- dcg robot/preflight 参考实现：<https://github.com/Dicklesworthstone/ntm/commit/8ca6ed70ce5719be892975d7110a50e3519e546c> — JSON `allowed`/`reason`/version/path 和“no execution” preflight 形态
- npm 包页：<https://www.npmjs.com/package/@howaboua/pi-codex-conversion> — 已发布版本、最低 Pi/Node 版本和 README 镜像

### 丢弃

- 搜索结果中的第三方 fork（luxus/teknologist 等）未用于判定目标插件当前行为，仅作为历史背景
- Pkg Stats、pi.dev 包目录仅用于版本/README 交叉验证，不作为源码行为的唯一依据

## 缺口

1. 尚未直接读取目标 commit 的 `package.json`、每个工具 schema 源文件和测试文件；实现前必须在本机 checkout 执行 `git show`/`rg`，特别核对 `exec_command` 的确切字段名、Code Mode `exec` input 结构和工具注册时机。
2. 尚未直接读取本机 Pi 0.84.2 的 `.d.ts`；应以本机安装包路径为准，确认包名（`@mariozechner/pi-coding-agent` 或 fork scoped package）、`ToolCallEventResult` 的 `terminate` 字段和 `isToolCallEventType` 是否存在。
3. `dcg --robot test` 的精确 stdin/JSON schema 必须以本机 dcg `--help`/源码为准；现有官方相关资料同时存在 dcg 原生 hook 与包装器 `--robot-dcg-check --command` 两种形态。

## 结论

Pi Guard 的最小可行集成不是“复用 bash handler”，而是“统一命令提取 + dcg preflight + 对不可提取 Code Mode 请求 fail-closed”。在确认 Code Mode host 可提供嵌套执行回调前，不应宣称覆盖了插件全部 shell 执行；工具事件层只能覆盖外层 `exec`/`wait` 和显式 `exec_command`/`write_stdin`，不能替代 sandbox。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "报告已写入 /Users/lystran/programming/ai/pi-extensions/research.md，包含插件工具/命令、输入输出、bash 绕过路径、Pi Guard/dcg 集成、安全边界、版本风险、最小实现和测试矩阵；每项事实均附 GitHub、npm 或 Pi 官方 URL，源码未能直接抓取处已明确标注缺口。"
    }
  ],
  "changedFiles": [
    "/Users/lystran/programming/ai/pi-extensions/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "已读取 .pi/skills/research/SKILL.md",
    "已完成多角度 web_search：目标插件、Pi 0.84.2 扩展 API/changelog、dcg robot/preflight",
    "未修改生产代码"
  ],
  "residualRisks": [
    "未能直接读取目标仓库 raw 源码、package.json 和 tests；精确 schema 仍需本机 checkout 复核",
    "未能直接读取本机 Pi 0.84.2 .d.ts；terminate 字段、包名和事件类型需本机确认",
    "dcg --robot test 的确切输入协议需以本机安装版本为准",
    "Code Mode 动态 JavaScript/custom tool 的嵌套 shell 不能仅靠外层 tool_call 可靠提取"
  ],
  "noStagedFiles": true,
  "diffSummary": "仅新增调研报告文件，未修改生产代码",
  "reviewFindings": [
    "高：仅监听 bash tool_call 会漏检 exec_command、write_stdin 和 Code Mode exec shell 路径",
    "高：动态 Code Mode/custom tool 命令不可静态可靠提取，需 fail-closed 或 host 回调协议",
    "中高：native helper/custom binary 是独立信任根，dcg 不覆盖其内部行为",
    "中：Pi 0.82+、0.84.2 与最新 API/事件行为需要版本矩阵验证"
  ],
  "manualNotes": "运行时要求的权威输出路径是 research.md；用户正文中提到的 docs/research/pi-codex-conversion-integration.md 未写入，以遵循本次运行的 authoritative output path。"
}
```

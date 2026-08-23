# Maven 输出格式化/压缩 Pi 扩展可行性调研

> 本报告按本次运行的权威输出路径保存为 `research.md`。仓库规范建议的 `docs/research/maven-output-compression-pi-extension.md` 与本次运行覆盖路径冲突，因此未写入该路径。未修改生产代码

## 摘要

可行，但公开 Pi 扩展 API 不提供通用的 Bash stdout/stderr 后处理钩子。推荐 MVP 做成“显式 Maven wrapper/tool”：由扩展注册 `/mvn` 命令（以及可选的 LLM tool），用 Node `child_process.spawn` 执行 `./mvnw` 或 `mvn`，捕获合并输出，成功时返回确定性的短摘要，失败时返回分类错误、受限尾部和原始日志路径；另提供 `--full`/`full` 逃生通道。也可以在 `tool_call` 事件中只对 `bash` 命令做保守的 `mvn`/`./mvnw` 改写，但这属于命令改写，不是输出拦截，容易误伤 shell 组合命令，不应作为唯一入口。

`mvn-lite` 的核心策略值得复用：批处理模式、禁用传输进度、禁用颜色；后台捕获完整日志；成功只显示 PASS 与耗时；失败保留退出码、分类提取编译/测试/依赖/目标错误、原始日志及测试报告目录提示。其 Bash/awk 实现只能直接作为外部 wrapper 或移植为 TypeScript 解析器，不能被 Pi 扩展 API 当作 Maven 内部插件注入。完整日志是权威证据，摘要始终是有损视图。

## 证实事实

1. **mvn-lite 是外部进程 wrapper，不是 Maven/Pi 插件** — 脚本在当前目录优先选择可执行 `./mvnw`，否则使用 PATH 中的 `mvn`，把参数保序转发，并在紧凑模式下追加 `-B`、`-ntp`、`-Dstyle.color=never`（仅当等价选项未提供）。[mvn-lite 脚本](https://raw.githubusercontent.com/ejboy/agent-scripts/main/scripts/mvn-lite)、[mvn-lite README/指南](https://raw.githubusercontent.com/ejboy/agent-scripts/main/docs/mvn-lite.md)

2. **mvn-lite 成功路径是捕获后单行输出** — 它将 Maven 的 stdout/stderr 合并到权限受限的临时日志，等待子进程结束，成功时输出 `PASS` 和 Maven 的 `[INFO] Total time:`，默认删除成功日志；`--keep-log` 保留路径。完整失败日志始终保留在 `.agent-logs/maven/`（可由 `MVN_LITE_LOG_DIR` 改变），并保留 Maven 原始退出状态。[mvn-lite 脚本](https://raw.githubusercontent.com/ejboy/agent-scripts/main/scripts/mvn-lite)、[指南的 Output/Scope 部分](https://raw.githubusercontent.com/ejboy/agent-scripts/main/docs/mvn-lite.md)

3. **mvn-lite 的失败提取是保守且格式驱动的** — awk 识别 Java 编译位置、`symbol`/`location`、Surefire/Failsafe 的 `<<< FAILURE|ERROR!`、异常、依赖解析、`Failed to execute goal` 及其同线 cause、POM/lifecycle/prefix 错误；去重、最多 24 条摘要项，未知格式退回最多 80 行尾部。失败时额外提示 `*/target/surefire-reports/` 与 `*/target/failsafe-reports/`。[mvn-lite 脚本](https://raw.githubusercontent.com/ejboy/agent-scripts/main/scripts/mvn-lite)、[指南的 Scope and failure logs](https://raw.githubusercontent.com/ejboy/agent-scripts/main/docs/mvn-lite.md)

4. **mvn-lite 对普通 Maven 行为有明确边界** — `--full`/`--raw` 直通完整实时输出；`dependency:tree`、`help:effective-pom`、`help:active-profiles` 等报告/检查目标建议直通；Maven 的 `-h`、`--help`、`-v`、`--version`、`-V`、`--show-version` 信息参数直通。[mvn-lite 指南](https://raw.githubusercontent.com/ejboy/agent-scripts/main/docs/mvn-lite.md)

5. **Maven 官方 CLI 明确支持降低源头噪声的参数** — `-B,--batch-mode` 启用非交互批处理（并禁用输出颜色），`-ntp,--no-transfer-progress` 禁止下载/上传传输进度，`-e,--errors` 输出执行错误消息，`-l,--log-file` 把全部构建输出写入文件，`-X,--debug` 输出调试信息，`-v` 显示版本并退出，`-V` 显示版本但继续构建。[Maven Embedder CLI Options Reference](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)

6. **Maven 的默认输出是面向人类的文本而非稳定 JSON API** — 官方 CLI 选项文档描述的是日志级别、错误/调试、传输进度和日志文件等开关；生命周期/插件输出由 Maven 核心和各插件产生，格式可包含 `[INFO]`、`[WARNING]`、`[ERROR]`、下载进度、插件自定义 stdout/stderr。由此可证实：解析器必须按已知模式处理，并保留原文作为回退，而不能假设完整稳定 schema。[Maven CLI Options Reference](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)、[mvn-lite 的保守回退实现](https://raw.githubusercontent.com/ejboy/agent-scripts/main/scripts/mvn-lite)

7. **Pi 的公开扩展能力覆盖命令、工具和事件** — 官方扩展文档定义 `ExtensionAPI` 的 `registerCommand`、`registerTool`、`on` 等入口；工具 `execute` 接收参数、AbortSignal、增量回调和 `ExtensionContext`。扩展可使用 Node 内置模块，因此 wrapper 可用 `node:child_process`、`node:fs`、`node:path`。[Pi extensions 文档](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md)、[Pi ExtensionAPI 类型源码](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)

8. **`tool_call` 能拦截的是调用意图，不是已产生的输出** — Pi 文档明确说明 `tool_call` 在工具执行前触发；对内置 Bash 可通过 `isToolCallEventType("bash", event)` 获取 `{ command, timeout? }`，原地修改 `event.input.command` 会影响实际执行，也可返回 `{ block: true, reason, terminate? }` 阻断。没有同等公开的“bash stdout/stderr 已完成后替换文本”事件；`tool_execution_update/end` 只观察执行状态/结果，不能把底层 shell 输出重新变成另一个命令结果。[Pi tool_call 文档](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md#tool-events)

9. **Pi 的 session/agent 事件不适合承担每次 Maven 输出过滤** — `agent_end` 可能之后仍有自动重试、自动压缩或 follow-up；官方文档建议需要确定不再自动继续时使用 `agent_settled`。这些事件是 agent 生命周期通知，既不提供 Maven 子进程 stdout，也不是稳定的单个 shell 调用结果转换点。[Pi agent events 文档](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md#agent-events)

10. **Pi 文档把扩展运行权限描述为完整系统权限** — 扩展可以执行任意代码；这使 `spawn` wrapper 在权限上可行，也意味着必须把命令参数、cwd、日志路径和超时处理作为安全/可靠性边界，不要把任意 LLM 文本未经检查拼入 shell。[Pi extensions 文档](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md#extension-locations)

## 设计推断与推荐边界

### 能否拦截/包装

- **推荐且已被公开 API 支持：显式 `/mvn` 命令**。`pi.registerCommand("mvn", ...)` 的 handler 直接获得用户传入的参数和 `ExtensionCommandContext`；扩展自身以 argv 数组调用 `spawn(executable, args, { cwd, stdio })`。这样不依赖 Bash 事件，参数边界可保留，输出可完整捕获，退出码可准确返回。
- **推荐作为 LLM 能力：`mvn` custom tool**。schema 至少包含 `args: string[]`、`mode: "compact"|"full"`、可选 `timeoutMs`；tool 返回 Pi 的 `content` 文本和机器可读 `details`。LLM 不应传任意 shell 字符串，也不应允许 wrapper flags 与 Maven args 混淆。
- **可选兼容层：`tool_call` 改写 Bash**。只在命令是单一 argv 形式、命令首 token 精确为 `mvn`/`./mvnw` 且没有 `|`、`;`、`&&`、重定向、后台符号或命令替换时改写为 wrapper；无法可靠解析时放行。该方案可复用现有 Bash 工具体验，但仍是“包装命令”，不是拦截输出。
- **不推荐/不可宣称支持：全局拦截任意 shell/Maven 输出**。当前公开 Pi API 没有把 Bash 子进程 stdout/stderr 交给扩展作后处理的契约；若要做到必须修改 Pi 核心或依赖私有实现，超出插件边界。

### 可复用与不可直接复用

- **可复用**：`./mvnw` 优先、argv 原样保序、`-B`/`-ntp`/无色注入、成功短行、失败退出码、完整日志、日志保留/清理、`--full` 逃生通道、保守模式匹配和最多条数上限。
- **需 TypeScript 重写**：Bash 的 signal 转发、临时文件、日志目录创建、mtime 清理和 awk 状态机。用 `spawn`、AbortController、`fs.mkdtemp`/明确文件名、`node:fs` 实现；不要在生产代码使用 Bun API。
- **只能作为外部 wrapper**：直接调用 `mvn-lite`，或把其整个 shell 脚本作为依赖命令。Pi 扩展不能把 awk 直接注入 Maven，也不能假定使用者安装了该仓库的 PATH。
- **不应照搬**：把所有未知失败只截尾 80 行、依赖英文 `[ERROR]` 文本作为唯一协议、对所有 Maven goal 都隐藏实时输出。应把完整日志路径和 `full` 模式作为一等回退，并允许项目/插件自定义输出。

### MVP API 与配置

建议包名 `@lystran/pi-mvn-output`，入口 `src/index.ts`，只使用 Pi 公开导出。MVP API：

```text
/mvn [--full|--keep-log] [--] <maven argv...>
pi.registerTool: mvn(args: string[], mode?: "compact"|"full", timeoutMs?: number)
```

默认配置（项目级 `.pi/mvn-output.json`，可选全局设置覆盖）建议：

```json
{
  "enabled": true,
  "executable": "auto",
  "mode": "compact",
  "injectBatchMode": true,
  "injectNoTransferProgress": true,
  "color": "never",
  "timeoutMs": 600000,
  "maxSummaryItems": 24,
  "fallbackTailLines": 80,
  "logDir": ".agent-logs/maven",
  "keepSuccessfulLog": false,
  "reportGlobs": ["**/target/surefire-reports", "**/target/failsafe-reports"]
}
```

配置应拒绝覆盖用户显式参数（例如已有 `-B`、`--no-transfer-progress`、`-Dstyle.color=*`）；应支持 `--full` 取消注入并实时转发。MVP 不读取/修改 POM，不调用模型二次总结，不自动猜测 Maven plugin 类型，不自动删除测试报告，不改变 Maven 的 cwd 或退出码。

## 信息保留策略

### 成功

保留：exit code 0、耗时（从 `[INFO] Total time:` 或本地计时取其一）、是否有 warning（可选计数）、执行目标摘要（从用户 argv，不从日志猜测）。默认不返回全量成功日志，但提供 `keepLog` 和日志路径。

### 失败

必须保留：非零 exit code（信号退出映射为明确状态）、完整合并日志文件、错误分类、最多 24 个去重摘要项、最多 80 行尾部回退、cwd、实际 executable、完整 argv（注意脱敏日志中可能含密码）、报告目录提示。不要只保留失败测试名称而丢失 forked JVM/插件堆栈。

### 多模块

摘要项应带模块标识；编译项保留相对路径和行列；插件失败保留 goal、project/module 和同线 cause；依赖失败保留 artifact 坐标和 repository/transfer 原因。不要把同名测试/模块错误合并成一条。全量日志按 Maven 原顺序保留 reactor 顺序和最终 reactor summary；MVP 可不解析 reactor summary，但不能删除它。

### 测试报告

Surefire 与 Failsafe 的 console 输出不总是包含足够的 assertion cause，且 forked 测试可把细节放入 XML。MVP 先提示报告目录并保留日志；下一阶段用 XML 解析器读取 `TEST-*.xml`，输出 suite/test/failure/error/skipped、classname、属性中的模块路径，并限制 XML 大小/实体解析，避免把 XML 当成信任输入。不要在第一版用正则解析 XML，也不要删除报告。

### 不确定与泄露

Maven/plugin 可能写彩色控制序列、进度回车、直接 stdout/stderr 或自定义格式；批处理/无传输进度只能降低一部分噪声。日志可能包含 token、repository 密码、环境变量或测试输入；日志默认应设 `0600`，结果摘要不要无条件回显 secret-like 行，并在文档警告日志的敏感性。

## 失败、测试与验证建议

失败处理至少覆盖：找不到 `mvnw`/`mvn`、不可执行 wrapper、spawn error、超时终止、SIGINT/SIGTERM 转发、退出码保留、日志不可写、Maven 非零、未知格式、`--full` 直通，以及显式静默参数不被重复注入。

测试只用本地 fake Maven executable，不访问网络或模型：成功输出/耗时；编译失败分类；Surefire/Failsafe 失败与 report hint；依赖失败；多模块同名错误不去重过度；参数含空格/`${...}`/`-D`；信号/超时；日志权限和清理；报告 XML 解析（若进入第二阶段）。使用仓库标准 `bun run verify` 验证；当前调研未改生产代码，未执行插件测试。

## 设计结论与未知项

**结论（高置信）**：插件可行，最佳边界是显式 wrapper/tool；Pi API 可以注册入口并改写 Bash 调用，但不能承诺全局 stdout 后处理。`mvn-lite` 的源头降噪、捕获日志、确定性摘要和退出码保留适合成为 MVP 基础。

**未知项（需实现前在本机确认）**：当前工作区安装的 Pi 包实际名称/版本及 `ExtensionAPI` 类型是否与在线 `badlogic/pi-mono` 文档一致；本机公开类型中 `ToolResult.details` 的精确类型；Pi 在 print/RPC 模式下对 `ctx.hasUI`、tool 输出和命令 handler 的具体呈现；Maven 4 与 Maven 3 wrapper 参数/日志差异；项目中是否已有统一 subprocess helper。仓库规范要求本机公开 API 优先于在线资料，因此实现阶段应读取本机依赖的 `.d.ts` 并锁定版本。

## 来源

- [agent-scripts README](https://raw.githubusercontent.com/ejboy/agent-scripts/main/README.md) — 项目定位、mvn-lite 用法和“agent 输出降噪”目标
- [mvn-lite 指南](https://raw.githubusercontent.com/ejboy/agent-scripts/main/docs/mvn-lite.md) — 官方行为、模式、日志和限制
- [mvn-lite 源码](https://raw.githubusercontent.com/ejboy/agent-scripts/main/scripts/mvn-lite) — 参数注入、捕获、信号和失败解析的直接证据
- [Pi 扩展文档](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md) — 公开 command/tool/event/context 能力
- [Pi 扩展类型源码](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts) — 类型归属和 API 一手来源
- [Maven Embedder CLI Options Reference 3.9.16](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html) — Maven 官方 CLI 参数

## 来源取舍

保留以上一手仓库源码、README/指南、Pi 官方文档/类型和 Maven 官方参考。未采用搜索结果中的第三方 Maven 过滤器、GitHub Actions 提交或 Pi issue 作为 API 事实；它们最多说明生态实践或未合并提议，不足以定义插件契约。

## 残余风险

- **高**：依赖 Maven/plugin 文本格式的解析器存在漏报/误报，必须保留原始日志并提供 full 模式
- **中**：通过 `tool_call` 自动改写 Bash 可能误判 shell 语法；MVP 应默认关闭或仅接受严格单命令
- **中**：日志中的凭据/秘密泄露；默认权限、路径和摘要脱敏必须测试
- **中**：跨 Maven 3/4、JDK、语言环境、插件版本的输出差异；需 fixture 矩阵
- **低**：在线文档与本机 Pi 版本漂移；实现前以本机 `.d.ts` 为准

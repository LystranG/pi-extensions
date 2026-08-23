# Maven 输出压缩策略调研

> 范围：仅给 AI 调用的 Pi Maven custom tool；优先当前目录可执行 `./mvnw`，否则 `PATH` 中的 `mvn`；仅 Maven 项目。本文只研究输出压缩，不修改生产代码。\n> 事实、设计建议、未知项分别标记为【事实】、【建议】、【未知】。\n
## 结论摘要

第一版应采用“原始日志为事实源、确定性规则提取、失败时强诊断、成功时极短摘要”的策略；直接借鉴 `mvn-lite` 的 wrapper 参数边界、`mvnw` 优先、保留原始失败日志、显式 informational/report goal 直通和返回 Maven 原始退出码。应改进其仅依赖文本/日志尾部的做法：保留 stdout 与 stderr 通道、记录参数和版本，支持模块上下文，按错误优先级去重，且不因截断隐藏完整日志路径。

第一版不解析 XML 报告。先做文本解析并保留报告路径；XML 解析应作为后续可选增强，因为报告可能被禁用、改目录、跨模块或由非 Surefire 测试插件生成，且失败时报告未必已经写完。

## 一手来源与 `mvn-lite` 评估

1. **直接借鉴**：`mvn-lite` 在当前目录优先可执行 `./mvnw`，否则 `mvn`；wrapper 选项放在 Maven 参数前，并用 `--` 结束 wrapper 解析；保留参数顺序和边界；失败返回 Maven 原始状态码。[mvn-lite 文档](https://github.com/ejboy/agent-scripts/blob/main/docs/mvn-lite.md)\n2. **直接借鉴**：compact 默认注入 `-B`、`-ntp`、`-Dstyle.color=never`，但只在等价选项未显式提供时注入；`--full/--raw` 直通；help/version 直通。[mvn-lite 源码](https://github.com/ejboy/agent-scripts/blob/main/scripts/mvn-lite)\n3. **直接借鉴**：成功输出 `PASS` 加耗时，失败输出分类摘要、完整日志路径和重跑提示；成功日志默认删除，失败日志保留并定期清理。[mvn-lite 文档](https://github.com/ejboy/agent-scripts/blob/main/docs/mvn-lite.md)\n4. **应改进**：其文本 awk 提取器最多 24 条、依赖最多 6 条，未知格式退化为日志尾部 80 行；这些是有用的上限和保守回退，但无法可靠区分 stdout/stderr、模块和并行输出，也没有统一的 warning/编译/测试计数模型。[mvn-lite 源码](https://github.com/ejboy/agent-scripts/blob/main/scripts/mvn-lite)\n5. **改进原则**：重复行可压缩，但只压缩明确的 Maven 仪式噪声（下载进度、生命周期成功行、重复堆栈框架帧）；任何不确定行进入未知区并保留。第三方实践也显示 Maven 噪声适合在源头以 `-B`、`-ntp` 降低，再做结构化过滤；不应把该项目的测量当 Maven 官方保证。[rtk Maven 过滤说明](https://github.com/rtk-ai/rtk/pull/1241)

## 保留策略

| 情况 | compact 摘要应保留 | 不应丢失/完整日志 |
|---|---|---|
| 成功 | `PASS`、退出码、耗时；若可确定，模块数、测试 totals | 原始 stdout/stderr 写入日志；默认可删除成功日志，但响应说明是否删除 |
| 失败 | `FAIL`、退出码、失败分类、首要原因、最多 N 条关键证据、日志路径 | 全部原始字节、命令（脱敏后）、cwd、退出信号 |
| 警告 | 警告计数；与失败相关或模型/插件配置/POM warning 的前 N 条 | 全部 warning，尤其带行列号、checksum、deprecation、未执行模块信息 |
| 测试 | 失败/错误测试名、类、异常首行、断言差异；总结 `tests/failures/errors/skipped` 仅在可验证时显示 | 完整 stack trace、`*-out.txt`、`*.dump*`、XML/文本报告路径。Surefire/Failsafe 默认分别位于 `target/surefire-reports` / `target/failsafe-reports`，Failsafe 同时生成 txt/xml。[Failsafe 介绍](https://maven.apache.org/surefire/maven-failsafe-plugin/) [Surefire FAQ](https://maven.apache.org/surefire/maven-surefire-plugin/faq.html) |
| 编译 | 文件相对路径、行列、错误/警告消息；错误优先 | 所有诊断行和完整日志 |
| 依赖 | artifact 坐标、解析/传输失败、仓库、offline/missing 信息 | caused by 链、URL、checksum、完整 resolver 输出 |
| 插件错误 | `group:artifact:version:goal`、project/module、同一行 Cause | 完整 Mojo exception、stack trace、插件输出 |
| 多模块 | reactor/module 名、每模块 PASS/FAIL/SKIPPED、失败模块及依赖关系；仅可确定时显示总数 | `[ERROR] Reactor Summary` 全文、并行构建中所有模块段落 |
| 未知输出 | 不猜分类；保留首尾有界片段并标注 `UNKNOWN_OUTPUT` | 完整日志和未知内容，避免静默过滤 |

## 参数、模式与直通规则

### 默认命令处理

【建议】只对 `./mvnw` 做 `-x` 检查并要求可执行；否则用 `mvn` 的 PATH 解析。不要改用户参数顺序。注入参数应置于用户参数之前，且仅对 compact 生效：`-B -ntp -Dstyle.color=never`。检测用户显式 `-B/--batch-mode`、`-ntp/--no-transfer-progress`、`-Dstyle.color=always|never|auto`，以及 Maven 4 的 `--color=...`/`-null` 形式时不覆盖。Maven 官方明确 `-B` 禁用交互并禁用颜色，`-ntp` 禁用传输进度，`-l` 会写日志文件并禁用颜色。[Maven CLI 选项](https://maven.apache.org/ref/current/maven-embedder/cli.html)

### `-X`、`-e`、`-l`、`-q`、`-B`、`-ntp`

- `-X/--debug`：【建议】默认切换到 full，或允许 compact 但只做极小的安全摘要并明确“debug output preserved in log”；绝不按普通日志大量折叠 debug 行。Maven 定义它为 execution debug output。[CLI](https://maven.apache.org/ref/current/maven-embedder/cli.html)
- `-e/--errors`：【建议】允许 compact，但完整异常链必须保存；摘要只取分类首行、Cause 和用户代码 stack frame。它要求 Maven 产生 execution error messages。[CLI](https://maven.apache.org/ref/current/maven-embedder/cli.html)
- `-l/--log-file`：【建议】不注入或改写用户 log file；tool 自己仍需 capture stdout/stderr。若 Maven 将输出重定向到用户文件，响应必须显示该路径，并标记 capture 可能不完整。官方说明 `-l` 写全部 build output 且禁用颜色。[CLI](https://maven.apache.org/ref/current/maven-embedder/cli.html)
- `-q/--quiet`：【建议】尊重用户意图，不自动改成 full；compact 仍输出 wrapper 的最终状态，但可提取的信息更少，未知项要明确。Maven 定义 quiet 为仅显示 errors。[CLI](https://maven.apache.org/ref/current/maven-embedder/cli.html)
- `-B/--batch-mode`、`-ntp/--no-transfer-progress`：【建议】若未显式给出则 compact 注入；显式值永远优先。[mvn-lite 源码](https://github.com/ejboy/agent-scripts/blob/main/scripts/mvn-lite)\n
ANSI/颜色：默认 `-Dstyle.color=never` 并在解析器中剥除 ANSI CSI、CR 覆盖和常见控制字符；保留原始日志不变。若用户明确 `always`，不要注入 never，解析仍应去 ANSI；若终端/管道语义会改变，应优先尊重用户参数而非追求漂亮摘要。

### compact/full

【建议】`compact` 是默认：捕获后输出结构化确定性摘要；失败保留完整日志路径。`full`/`--raw` 直接透传实时 stdout/stderr，不做摘要、不注入 quiet 参数；仍返回原始退出状态。`--keep-log` 只控制成功日志是否保留，不改变摘要。建议默认摘要上限：最多 40 行、8 KiB、最多 24 个 finding；单条最多 1 KiB；失败上下文取关键片段前后各 3 行。上限按字节而非字符执行，UTF-8 截断时回退到有效边界。完整日志建议 `0600`、项目下 `.agent-logs/maven/`，失败保留，成功默认删除；保留日志需 TTL（如 7 天）并显示路径。

## 不应压缩的命令

【建议】以下请求直接 full：Maven informational `-h/--help`、`-v/--version`、`-V/--show-version`；以及 report/inspection goal：`dependency:tree`、`help:*`（除 wrapper 自己的 help）、`help:effective-pom`、`help:active-profiles`、`dependency:analyze`、`site`、`surefire-report:*`、`failsafe-report-only`。理由是这些 goal 的主要产物就是人类可读报告，压缩会损失用户主动请求的数据；mvn-lite 文档也明确 reporting/inspection goal 可能需要 `--full`。[mvn-lite 文档](https://github.com/ejboy/agent-scripts/blob/main/docs/mvn-lite.md) Surefire report goal 只生成报告且不运行测试。[Surefire Report Plugin](https://maven.apache.org/surefire/maven-surefire-report-plugin/)

检测应使用 token 化参数：剥离 `-Dkey=value`、`--` 后识别 goal；不要用整串正则误判 `-Dfoo=help`。用户显式 `--full/--raw` 优先级最高；其次 informational/report 直通；其余 compact。用户显式 Maven 参数绝不删除或重排。

## XML 报告决策

【建议】第一版**不解析 XML**，但在摘要中做只读路径发现：每个模块下按约定查找 `target/surefire-reports/TEST-*.xml`、`target/failsafe-reports/TEST-*.xml` 和 `failsafe-summary.xml`，只报告存在的路径，不把不存在视为失败。文本解析足以处理 Maven 失败前的常见 `Tests run: ...` 和失败行；报告可能被 `disableXmlReport`、自定义 `reportsDirectory`、插件/框架替换或尚未 flush。官方资料确认 Surefire Report Plugin 解析 `TEST-*.xml`，Failsafe XML schema/默认目录存在，但也确认报告格式和目录可配置。[Surefire Report](https://maven.apache.org/surefire/maven-surefire-report-plugin/) [Failsafe integration-test 参数](https://maven.apache.org/surefire/maven-failsafe-plugin/integration-test-mojo.html)

【后续建议】若增加 XML，使用 Node 标准 XML 解析依赖或项目已有安全 parser；禁止正则解析 XML；限制文件大小/实体展开，按 `testsuite/testcase/failure/error/skipped` 读取，XML 仅增强计数和失败详情，永远不能覆盖进程退出码或日志中的插件错误。

## 确定性的 TypeScript 策略与分类

1. 采集：spawn 不经 shell，argv 原样保存；stdout/stderr 分别 append 到临时文件，同时限制内存 buffer；记录开始/结束时间、退出码、signal、Maven executable。
2. 规范化：逐行读取；去 ANSI；将 CR 覆盖行按最后可见内容处理；保留原始文件。对行保存 `raw`, `normalized`, `stream`, `index`。
3. 分类优先级：`invocation`（无法启动/权限/找不到 Maven） > `maven-cli`（unknown phase、参数解析） > `pom/model` > `dependency` > `plugin` > `compiler` > `test` > `reactor` > `warning` > `unknown`。同一行只进入最高优先级；相同 key 去重，保留第一次和最后一次位置。
4. 规则：编译匹配 `path.java:[line,col] message`；测试匹配 Surefire/Failsafe summary、`<<< FAILURE!/ERROR!`、`Tests run:`；依赖匹配 `Could not resolve dependencies`、`Could not find artifact`、`Could not transfer artifact`；插件匹配 `Failed to execute goal G:A:V:goal ... on project/module`；Maven CLI 匹配 `Unknown lifecycle phase`、`No plugin found for prefix`；POM 匹配 `Some problems ... POMs`、`Non-resolvable parent POM`。
5. reactor：优先解析 `Reactor Summary` 的模块状态；无法关联时只显示原始 summary 片段，不推断模块总数。并行 `-T` 时按日志序号，不按出现顺序重排。
6. 摘要：失败分类按优先级输出，每类最多 6 条；测试失败每类最多 10 条；首尾片段和日志路径总计受上述 40 行/8 KiB 上限约束。成功只显示 PASS；warning-only 成功显示 `PASS (N warnings)`。
7. 回退：无匹配失败证据时输出 `UNKNOWN_OUTPUT` 加日志头 20 行和尾 60 行（受总上限），并给完整日志路径；解析异常、非 UTF-8、超大行、报告读取失败均不能使 tool 自身失败，只标记 `parserWarning`。

退出语义：Maven 退出码原样返回；无法 spawn 用固定 tool error 分类并返回非零（建议 127/126 按 ENOENT/EACCES 区分）；signal 转换为 shell 约定值仅在 Node spawn API 需要时记录，不能把失败改为成功。

## Fake Maven 测试矩阵

使用 fake executable 写入 stdout/stderr、生成目标文件并退出指定码；每个 case 断言 argv、状态、摘要上限、日志存在性和返回码：

| Case | 期望 |
|---|---|
| `./mvnw` 与 PATH `mvn` 同时存在 | 只调用可执行 `./mvnw` |
| `./mvnw` 不可执行/不存在 | 调用 PATH `mvn`；两者都无则启动错误 |
| 成功普通 `clean verify` | 注入 `-B -ntp -Dstyle.color=never`，一行 PASS，成功日志默认删 |
| 用户已有 `-B -ntp -Dstyle.color=always` | 不重复/不覆盖，颜色仍能解析 |
| `--full`、`--raw`、`--` 边界 | 实时直通，argv 顺序完全不变 |
| `-X`, `-e`, `-l`, `-q` | 分别验证 debug、exception、用户 log、quiet 的不覆盖规则 |
| `-h`, `-v`, `-V`, `help:*`, `dependency:tree`, `site` | full 直通，不压缩报告 |
| 编译失败（多文件/重复行） | Compiler findings 去重、行列和消息保留 |
| Surefire 失败、Failsafe 失败、跳过 | Test 名/异常/计数；报告路径发现 |
| 依赖缺失、传输失败、checksum | Dependency 分类，保留坐标/仓库/cause |
| plugin goal failure 与 Mojo cause | Goal + Cause，完整日志保留 |
| POM/model 与 unknown lifecycle | Maven/POM 分类，去 `[Help N]` 不去核心原因 |
| 多模块 `Reactor Summary`、`-pl/-am`、`-T` | 模块状态保留；不错误重排并行输出 |
| warning-only、ANSI、CR、UTF-8 和超长行 | warning 计数；规范化摘要；原文无损；上限稳定 |
| 子进程被 SIGTERM、超时、非零无输出 | signal/启动分类；UNKNOWN_OUTPUT 回退；原始状态记录 |
| XML 缺失/禁用/损坏/自定义目录 | 第一版只报告发现失败/路径，不因 XML 影响 Maven 结果 |

## 事实、建议与未知项边界

【事实】Maven CLI 定义了上述选项及其语义；`-B` 禁用颜色，`-l` 禁用颜色，`-q` 仅错误，`-X` debug，`-e` execution errors，`-ntp` 禁止传输进度。[官方 CLI](https://maven.apache.org/ref/current/maven-embedder/cli.html) Maven logging 使用 SLF4J，CLI verbosity 会调整默认 root logging level。[官方 logging](https://maven.apache.org/ref/current/maven-embedder/logging.html)

【事实】Failsafe 输出 txt/xml，默认 `target/failsafe-reports/TEST-*.xml`，并有 summary XML；Surefire report plugin 解析 `TEST-*.xml`。[Failsafe](https://maven.apache.org/surefire/maven-failsafe-plugin/) [Report plugin](https://maven.apache.org/surefire/maven-surefire-report-plugin/)

【未知】不同 Maven 版本、插件、自定义 logger、颜色实现、测试框架和 Maven 4 新输出可能改变文本格式；官方没有承诺适合 AI 的稳定日志 schema。`mvn-lite` 的实验压缩比例也不是本工具的保证。XML 自定义目录、报告禁用和第三方测试插件覆盖率需要真实项目样本验证。

【建议默认值】默认 compact；默认注入 `-B -ntp -Dstyle.color=never`（只补缺失等价项）；40 行、8 KiB、单条 1 KiB、24 findings；失败日志保留 7 天，成功日志删除；report/help/version/full/debug 直通；原始退出码和完整日志路径始终返回。

## Sources

- [agent-scripts `mvn-lite` 文档](https://github.com/ejboy/agent-scripts/blob/main/docs/mvn-lite.md) — wrapper 行为、失败日志和实验边界
- [agent-scripts `mvn-lite` 源码](https://github.com/ejboy/agent-scripts/blob/main/scripts/mvn-lite) — 实际注入、分类和上限
- [Maven CLI options](https://maven.apache.org/ref/current/maven-embedder/cli.html) — 官方参数语义
- [Maven Logging](https://maven.apache.org/ref/current/maven-embedder/logging.html) — Maven/SLF4J 日志机制
- [Failsafe Plugin introduction](https://maven.apache.org/surefire/maven-failsafe-plugin/) — 报告格式和默认目录
- [Surefire Report Plugin](https://maven.apache.org/surefire/maven-surefire-report-plugin/) — XML 解析和 report goal 行为
- [Failsafe integration-test mojo](https://maven.apache.org/surefire/maven-failsafe-plugin/integration-test-mojo.html) — XML 可配置项
- [Surefire FAQ](https://maven.apache.org/surefire/maven-surefire-plugin/faq.html) — dump 文件和 forked JVM 诊断

## Gaps

未在本次调研中运行真实 Maven 项目或读取本仓库 Maven tool 的现有接口；因此上限数值是建议而非性能结论。实现前应以 fake Maven 矩阵覆盖规则，再用至少一个单模块、一个 Surefire/Failsafe 项目和一个多模块并行项目校准摘要质量。

## Acceptance

- 生产代码：未修改
- 报告内容：已覆盖 `mvn-lite` 借鉴/改进、各类输出保留、XML 决策、长度/完整日志、CLI 参数、compact/full、直通 goal、TS 解析/分类/回退、默认值和 fake Maven 矩阵
- 权威输出：`/Users/lystran/programming/ai/pi-extensions/research.md`

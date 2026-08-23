# Maven 参数语义审计：`@lystran/pi-mvn-output`

> 研究范围：Maven CLI、Surefire/Failsafe、Reactor 以及可借鉴的紧凑输出实现。本文只做研究，不修改生产代码。关键结论按【事实】【风险】【建议】标注。官方事实优先引用 Apache 官方参考；经验性判断明确标为启发式。

## 摘要

当前插件只在 compact 模式注入 `-B`、`-ntp`、`-Dstyle.color=never`，并把 stdout/stderr 合并写入日志；摘要通过 Maven 文本正则和扫描 `surefire-reports`/`failsafe-reports` 目录生成。最大缺口不是继续增加“静音参数”，而是识别会改变结果语义、测试执行范围、reactor 完整性和日志可观测性的参数，并在有风险时降级为 full 或明确标记 UNKNOWN。

最高优先级是：尊重用户显式参数且识别 `-q/-X/-e/-l/--color` 等输出模式；对 `-fn`、`-DtestFailureIgnore`、`-Dmaven.test.failure.ignore`、Failsafe 的 `skip/failure-ignore` 和 rerun/flaky 语义做结果告警；从 XML 报告读取计数和错误类型而不是仅累加控制台行；识别 `-fae/-rf/-pl/-am/-amd/-N/-T`，避免把部分 reactor 当作全局 PASS；并保证日志路径与 `-l` 语义不冲突。

## 当前代码基线

【事实】[plugins/mvn-output/src/command.ts](../plugins/mvn-output/src/command.ts) 只检测 batch、transfer progress、color；compact 模式只注入三项。没有检测 quiet/debug/errors/log-file/failure mode/测试筛选或 reactor 参数。【事实】[plugins/mvn-output/src/executor.ts](../plugins/mvn-output/src/executor.ts) 将两个 pipe 合并到同一个 `output` 和私有日志，但没有保存 stdout/stderr 的来源；`-l` 时 Maven 自己将所有构建输出写到用户指定文件，插件仍建立另一份日志。【事实】[plugins/mvn-output/src/summary.ts](../plugins/mvn-output/src/summary.ts) 累加所有匹配 `Tests run:` 的行，依据 `exitCode !== 0` 或 failures/errors > 0 判定失败；没有读取 XML 内容。【事实】[plugins/mvn-output/src/reports.ts](../plugins/mvn-output/src/reports.ts) 仅发现目录，不验证报告是否属于本次执行、是否为空、是否禁用 XML 或报告是否过期。

## 参数/语义审计表

| 参数/语义 | 影响 | 当前插件 | 风险 | 建议动作 |
|---|---|---|---|---|
| `-B/--batch-mode` | 非交互；官方说明同时禁用输出颜色 | 已检测/只在 compact 注入 | 低；用户值必须保留 | 尊重 |
| `-ntp/--no-transfer-progress` | 隐藏下载/上传进度 | 已检测/注入 | 低 | 尊重 |
| `--color=auto|always|never`、`-Dstyle.color` | 输出颜色策略；`-B`/`-l`还有颜色副作用 | 检测不完整（如分离参数、重复参数） | 中；ANSI 清理会掩盖用户要求，颜色转义可能跨 chunk | 尊重；compact 默认仅在无显式值时注入 |
| `-q/--quiet` | 只显示错误 | 未处理 | 高；报告/摘要可能没有测试行，不能把缺失统计当 0 | 尊重；compact 提示“统计可能缺失”，必要时 full |
| `-X/--debug` | 产生 execution debug output | 未处理 | 中；日志膨胀，正则将 debug 行与错误混合 | 尊重；保留 full 日志，摘要限流 |
| `-e/--errors` | 产生 execution error messages/堆栈 | 未处理 | 中；错误类型和头尾截断可能丢失 cause | 尊重；保留堆栈路径/报告 |
| `-l/--log-file <file>` | 所有 build output 写入指定文件并禁用颜色 | 未处理 | 高；插件日志不是 Maven 指定日志，stdout 可能近乎为空，logPath 误导 | 尊重；解析值并把用户 log file 与插件日志分开 |
| `-D maven.logging`、`-Dorg.slf4j.simpleLogger.*` | 改变日志级别、日期/线程/名称、目标流等；插件日志可能完全不含标准 `[INFO]` | 未处理 | 高；行首级别正则、warning 计数、错误分类失效 | 尊重；检测 logging properties 时降级为结构化报告/UNKNOWN |
| `--fail-fast/-ff` | reactor 首个失败即停止 | 未处理（默认 Maven 常为此） | 高；后续模块未执行，最后摘要不能代表全 reactor | 仅摘要提示模块未完成；不要注入 |
| `--fail-at-end/-fae` | 非受影响模块继续，最后统一失败 | 未处理 | 高；失败模块和后续成功模块交错，末行可能 SUCCESS | 仅摘要提示；按 reactor summary/XML 聚合 |
| `--fail-never/-fn` | 无论项目结果如何都不使构建失败 | 未处理 | P0；exit 0 但构建/测试失败 | 尊重；强制语义状态 FAIL/ATTENTION，不把 exit 0 当 PASS |
| `-o/--offline` | 禁止联网解析 | 未处理 | 中；缓存缺失会导致 dependency/POM 失败；耗时与通常构建不同 | 仅摘要提示；尊重 |
| `-U/--update-snapshots`、`-nsu` | 强制检查快照/缺失 release，或抑制快照更新 | 未处理 | 中；网络/耗时显著变化，结果复现性降低 | 仅摘要提示；尊重，不自动改写 |
| `-T/--threads` | reactor/构建并行；输出交错、耗时/资源改变 | 未处理 | 高；文本顺序不是执行顺序，重复行/模块边界错配 | 仅摘要提示；XML/模块路径优先 |
| `-N/--non-recursive` | 不进入子项目 | 未处理 | 高；root PASS 不是全体项目 PASS | 仅摘要提示；记录 scope=non-recursive |
| `-pl/--projects` | 仅构建指定 reactor 项目 | 未处理 | 高；总数和成功范围缩小，路径/坐标解析复杂 | 仅摘要提示；记录 selected projects |
| `-am/--also-make`、`-amd/--also-make-dependents` | 扩大 `-pl` 的上游/下游集合 | 未处理 | 高；实际 reactor 集合与用户肉眼预期不同 | 仅摘要提示；记录 effective scope |
| `-rf/--resume-from` | 从指定模块恢复 | 未处理 | 高；本次天然是部分构建；旧报告易混入 | 仅摘要提示；本次报告隔离/按时间或新目录识别 |
| `-DskipTests` | 编译测试但不运行测试 | 未处理 | P0；exit 0 且无测试计数不等于测试 PASS | 尊重；状态标记 SKIPPED/NOT_RUN |
| `-Dmaven.test.skip=true` | 跳过测试运行且跳过测试编译；Surefire/Failsafe/Compiler 都尊重 | 未处理 | P0；更强的未验证状态 | 尊重；状态 NOT_RUN |
| `-Dtest`、`-Dit.test` | 只运行匹配测试；支持 includes/excludes/方法语法，IT 由 Failsafe 使用 | 未处理 | 中；计数是子集，不能当全量回归 | 仅摘要提示；显示 selection |
| `-Dsurefire.failIfNoSpecifiedTests`（以及插件对应 `failIfNoTests`） | 无匹配测试时可失败或成功 | 未处理 | 高；0 tests 可能是选择错误也可能是合法空集 | 尊重；0 tests 必须显式标识 |
| `-DtestFailureIgnore=true`、`-Dmaven.test.failure.ignore=true` | 测试失败可被忽略，Maven 可保持 0 | 已通过计数补救 failures/errors，但仅文本 | P0；崩溃、跳过、报告缺失、Failsafe verify 差异仍漏判 | 尊重；结构化报告判定并标记 FAIL-IGNORED |
| `-DskipITs`、Failsafe `skipTests`/`skip` | 跳过 IT 或执行；有的仍编译 | 未处理 | 高；Surefire 与 Failsafe 计数范围混淆 | 尊重；分别标记 unit/IT NOT_RUN |
| Surefire/Failsafe `rerunFailingTestsCount` | 失败测试重跑，最终可能通过；报告包含重试/flake 信息 | 未处理 | 高；文本 `Tests run` 及 failures 不能表达初始失败和最终状态 | 仅摘要提示；XML 解析重试/flake |
| `failOnFlakeCount` | 累计 flaky 次数达到阈值才让整体失败，0 表示不限 | 未处理 | 高；exit 0 可能带 flake，不能简化为 PASS | 尊重；PASS-WITH-FLAKES/FAIL |
| `skipAfterFailureCount` | 达到失败/错误数后停止测试集 | 未处理 | 中；未执行测试被误当总数 | 仅摘要提示；标注 truncated execution |
| Surefire/Failsafe `forkCount`、`reuseForks`、`parallel`、`threadCount`、`useUnlimitedThreads` | fork/JVM 并发、内存、输出顺序；可能出现 crashed fork | 未处理 | 高；stdout 不完整，模块/测试顺序不可靠 | 仅摘要提示；报告优先，崩溃单独分类 |
| `redirectTestOutputToFile`、`useFile`、`reportFormat`、`disableXmlReport`、`reportsDirectory` | 测试输出移至文件、改变报告路径/格式或禁用 XML | 未处理 | P0；当前只扫固定目录且不读报告，统计/错误详情缺失 | 尊重；发现配置后明确报告不可用 |
| 参数顺序、重复参数 | Commons CLI/Maven 对重复 user property/option 的最终值、目标顺序有语义；`-D` 通常按最终属性传递但不应猜测所有插件行为 | 只原样追加注入项 | 中；注入项位置影响目标/属性覆盖，分离值未识别 | 注入到用户参数前；检测重复并仅提示，不合并/删除 |
| Maven 3/4：`--color`、`--raw-streams`、新 builder/Resolver 选项 | CLI 集合与 reactor/输出实现演进；Maven 4 有兼容性变化 | 未处理版本 | 高；硬编码 3.x 行格式不稳定 | 读取 `-version`/日志版本；版本未知时保守降级 |

官方 CLI 依据：[Maven Embedder CLI Options Reference](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)。Surefire/Failsafe 参数依据：[Surefire test mojo](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html)、[Failsafe integration-test mojo](https://maven.apache.org/surefire/maven-failsafe-plugin/integration-test-mojo.html)、[Failsafe verify mojo](https://maven.apache.org/surefire/maven-failsafe-plugin/verify-mojo.html)、[Skipping tests](https://maven.apache.org/surefire/maven-surefire-plugin/examples/skipping-tests.html)。

## exit code 0 但不应视为 PASS 的场景

【事实】`-fn` 官方定义为无论项目结果如何都不使构建失败。[CLI reference](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)。【事实】Surefire/Failsafe 的 `testFailureIgnore`/`maven.test.failure.ignore` 可忽略测试失败；Failsafe 的失败通常在 `verify` 阶段报告，而非 `integration-test` 阶段。[Failsafe introduction](https://maven.apache.org/surefire/maven-failsafe-plugin/)、[Failsafe verify](https://maven.apache.org/surefire/maven-failsafe-plugin/verify-mojo.html)。【事实】`skipTests` 不运行测试但仍可编译测试，`maven.test.skip` 连测试编译也跳过。[Skipping tests](https://maven.apache.org/surefire/maven-surefire-plugin/examples/skipping-tests.html)。

已知应标为非 PASS 的集合：

1. `-fn` 与任意 reactor/test failure
2. `-DtestFailureIgnore=true`、`-Dmaven.test.failure.ignore=true`、Surefire/Failsafe `<testFailureIgnore>true</...>`
3. `-DskipTests=true`、Failsafe `-DskipITs=true`、Failsafe skip 配置
4. `-Dmaven.test.skip=true`（测试未编译且未运行）
5. `-Dtest`/`-Dit.test` 无匹配且 `failIfNoSpecifiedTests=false`（默认空集可能成功）
6. `rerunFailingTestsCount>0` 后最终通过：应为 PASS-WITH-FLAKES，而非无条件 PASS；`failOnFlakeCount` 阈值与 flake 计数还可能使最终失败
7. `skipAfterFailureCount` 导致测试集提前停止：报告成功/退出 0 也不代表完整测试集已执行
8. Failsafe 只执行 `integration-test` 未执行 `verify`：生命周期设计上失败可能尚未传递到最终状态
9. 报告被禁用、写到非默认目录、fork/JVM 崩溃但 Maven 外层被忽略或输出截断：没有证据证明 PASS

其中 1-5 是官方参数语义；6-9 的“状态标签”是插件产品层的保守启发式，必须通过 XML、summary XML、reactor summary 和进程状态共同确认。

## compact 误判面

【风险】当前 `extractTestCounts` 对所有文本行简单累加：

- 多模块、Surefire+Failsafe、重试输出可能重复计数；同一测试集既有 provider 摘要又有 reactor/报告摘要时会膨胀
- `-q`、`-l`、`redirectTestOutputToFile`、`disableXmlReport` 会让计数缺失；缺失不能归零
- `skipTests`/`maven.test.skip`/`-Dtest` 产生 0 或子集，当前若无失败行仍输出 PASS
- 并行 `-T`/Surefire parallel 使行交错，模块归属不能由邻近文本推断
- rerun/flake、`skipAfterFailureCount` 使“Tests run”不等同于声明测试总数

【风险】`collectFindings` 只识别少数固定英文短语和 `[LEVEL]` 前缀：`-Dorg.slf4j.simpleLogger.*` 改变级别格式后，warning、plugin、reactor 识别会失效；`-X/-e` 的嵌套 cause 可能被 MAX_FINDINGS 截掉；颜色/终端覆盖行清理不等同于保留原始日志语义。

【风险】模块状态会被误判：`-N`、`-pl`、`-rf` 是有意的部分 reactor；`-ff` 是未完成 reactor；`-fae` 会有失败与成功交错；`-am/-amd` 改变有效项目集合；`-T` 改变顺序。Maven Reactor 文档对 `-pl/-am/-amd/-rf` 的定义见 [Guide to Working with Multiple Modules](https://maven.apache.org/guides/mini/guide-multiple-modules.html)，失败模式见 [Guide to Working with Multiple Modules](https://maven.apache.org/guides/mini/guide-multiple-modules.html)。

【事实】Surefire/Failsafe 默认 XML 报告位于 `target/surefire-reports/TEST-*.xml` 和 `target/failsafe-reports/TEST-*.xml`，Failsafe 另有 `failsafe-summary.xml`。[Surefire introduction](https://maven.apache.org/surefire/maven-surefire-plugin/)、[Failsafe introduction](https://maven.apache.org/surefire/maven-failsafe-plugin/)。因此 XML 是更稳定的证据面，但“默认路径存在”不是插件保证：配置可改变路径或禁用报告。

## `mvn-lite`/类似实现

【事实】本轮公开检索没有确认名为 `mvn-lite` 且可作为一手依据的稳定 Apache/官方项目；搜索结果中可核验的相近实现是 [jerrinot/llmaven MSE](https://github.com/jerrinot/llmaven) 和 [rtk Maven filtering PR](https://github.com/rtk-ai/rtk/pull/1241)。MSE 使用 Maven `EventSpy`、统一前缀和 Surefire/Failsafe XML 解析；rtk 采用版本探测后注入 `--no-transfer-progress` 与 batch mode，并偏向 wrapper。

【建议】可借鉴：wrapper 优先、版本探测、机器可识别前缀、完整日志、XML/事件结构化统计。不可照搬：强制静音或简单行过滤；Maven 插件可以自定义日志、fork 输出和 reactor 调度，文本“看起来安静”不代表结果完整。若仓库内部另有 `mvn-lite`，应在下一轮以其源码提交版本作为本地一手证据补充，而不要把第三方实现当 Maven 保证。

## P0/P1/P2

### P0

1. 识别 `-fn`、测试 ignore、`skipTests`、`maven.test.skip`、`skipITs`、`-Dtest/-Dit.test`、`failIfNo*`；输出 `PASS/FAIL/NOT_RUN/PASS_WITH_FLAKES/UNKNOWN`，不要只看 exit code
2. 读取并校验 Surefire/Failsafe XML 与 `failsafe-summary.xml`，按模块/报告文件去重；报告缺失时明确 `UNVERIFIED`
3. 识别 `-l`、`-q`、`-X`、`-e`、logging system properties；保证用户日志路径与插件私有日志同时可追踪
4. 识别 reactor scope/strategy：`-N/-pl/-am/-amd/-rf/-ff/-fae/-T`，摘要显示“本次构建范围”和“未执行模块”

### P1

1. 处理 `rerunFailingTestsCount`、`failOnFlakeCount`、`skipAfterFailureCount`、fork/parallel/JVM 崩溃和测试输出重定向
2. 用版本/能力检测处理 Maven 3/4 CLI 差异；不假设 `[INFO]` 行格式
3. 记录 `-o/-U/-nsu`、`--strict-checksums` 等会影响可复现性、依赖解析和时长的上下文

### P2

1. `-P/-f/-s/-gs/-t/-gt` 作为调用上下文摘要，不改变语义
2. 参数重复/分离值解析器与脱敏增强
3. 可选机器可读执行记录（模块、报告、结果来源、未验证原因），避免继续堆叠正则

原则：插件不应把所有 Maven 参数硬编码成规则；优先定义少量“改变证据可信度”的类别：输出通道、测试选择/跳过、失败传播、reactor 范围/调度、报告可用性、依赖复现性。

## Fake Maven 与真实项目验收矩阵

| 场景 | fake Maven 应输出/退出 | 验收断言 |
|---|---|---|
| 普通单模块 2 pass | 标准 `[INFO]`, exit 0 | PASS，计数 2/0/0/0 |
| failure + `-fn` | failure 文本，exit 0 | FAIL/IGNORED，不是 PASS |
| `-DskipTests` | 无测试行，exit 0 | NOT_RUN，不能显示 0 tests PASS |
| `maven.test.skip` | 编译与测试均跳过 | NOT_RUN + 原因 |
| `-Dtest=NoSuchTest` 两种 failIf 配置 | 0 tests，exit 0/1 | 0 tests 显式；按策略 FAIL 或 NOT_RUN |
| Failsafe integration failure then verify | IT 文本与 summary XML | verify 前后状态区别清楚 |
| rerun/flaky 与 failOnFlakeCount | 初次失败、最终通过/阈值失败 | PASS_WITH_FLAKES 或 FAIL，计数不重复 |
| fork crash/partial XML | 崩溃 stderr，缺/残 XML | CRASH/UNKNOWN，不误判 PASS |
| `-q`, `-X`, `-e`, `-l`, custom logger | 不同格式/通道 | 保留日志路径，摘要声明证据缺口 |
| `-ff`, `-fae`, `-T` 多模块 | 交错/中止/后续模块继续 | 按模块状态，不依赖最后一行 |
| `-pl -am -rf` | 子集、上游、恢复 | scope 正确，旧报告不混入 |

真实项目至少覆盖：单模块 Surefire、单模块 Failsafe、unit+IT、多模块依赖 DAG、并行 reactor、wrapper 固定 Maven 3.9.x、Maven 4 RC/GA、无网络 `-o`、snapshot `-U/-nsu`、自定义 `reportsDirectory` 和 XML 禁用配置。每项同时保存 compact、full、插件私有日志、Maven `-l` 文件、XML 报告和 exit code。

## 官方保证与启发式边界

【事实/官方保证】CLI 选项的直接效果、Surefire/Failsafe 参数 user property、默认报告路径、Failsafe 在 `verify` 汇总失败，均以 Apache 文档为准。Maven 官方 CLI 参考还显示当前 3.9.x 已包含 `--color`、`--raw-streams`、`-itr` 等选项，不能假定仅有旧版参数。[CLI reference](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)

【经验性启发式】任何“exit 0 + 没看到失败行 = PASS”、按最后一行判断 reactor、按文本 `Tests run` 累加、固定目录存在即代表本次报告有效、检测到某个 `-D` 前缀即可推断最终属性值，均不是 Maven 官方保证。产品应把这些结论降级为证据不足或结合结构化报告验证。

## Gaps

1. 未找到可核验的、明确名为 `mvn-lite` 的官方仓库；应由维护者提供确切 URL/commit 后补做源码逐项对照
2. Maven 3 与 Maven 4 的所有重复参数覆盖规则、具体 logger property 组合和各插件版本的 flake XML 字段需要以目标版本实跑确认，不能仅凭 CLI 文档推断
3. 本报告未运行真实网络/模型或 Maven 项目；验收矩阵是建议，不是执行结果

## Sources

- Apache Maven CLI Options Reference — CLI 一手定义：[maven.apache.org/ref/3.9.16/maven-embedder/cli.html](https://maven.apache.org/ref/3.9.16/maven-embedder/cli.html)
- Apache Maven Multiple Modules Guide — Reactor 范围、排序和失败模式：[maven.apache.org/guides/mini/guide-multiple-modules.html](https://maven.apache.org/guides/mini/guide-multiple-modules.html)
- Apache Surefire test mojo — 测试选择、跳过、fork、报告相关参数：[maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html)
- Apache Failsafe integration-test/verify mojo — IT 执行和失败传播：[integration-test-mojo.html](https://maven.apache.org/surefire/maven-failsafe-plugin/integration-test-mojo.html)、[verify-mojo.html](https://maven.apache.org/surefire/maven-failsafe-plugin/verify-mojo.html)
- Apache Surefire/Failsafe introductions — 默认 XML/TXT 报告和生命周期：[Surefire](https://maven.apache.org/surefire/maven-surefire-plugin/)、[Failsafe](https://maven.apache.org/surefire/maven-failsafe-plugin/)
- Apache Surefire rerun/parallel/logging examples — 重试、并发、输出行为：[rerun](https://maven.apache.org/surefire/maven-surefire-plugin/examples/rerun-failing-tests.html)、[parallel](https://maven.apache.org/surefire/maven-surefire-plugin/examples/fork-options-and-parallel-execution.html)、[logging](https://maven.apache.org/surefire/maven-surefire-plugin/examples/logging.html)
- MSE 相近实现：[github.com/jerrinot/llmaven](https://github.com/jerrinot/llmaven)

## Acceptance evidence

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已审计 plugins/mvn-output/src/command.ts、executor.ts、summary.ts、reports.ts，并将参数级风险与文件路径写入本报告"
    }
  ],
  "changedFiles": [
    "/Users/lystran/programming/ai/pi-extensions/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "已读取并遵循 .pi/skills/research/SKILL.md；通过 Apache Maven/Surefire/Failsafe 官方页面和源码仓库检索并核对关键事实；未运行真实 Maven/网络验收"
  ],
  "residualRisks": [
    "未确认名为 mvn-lite 的确切源码仓库",
    "Maven 3/4 重复参数覆盖和部分 logger/flake 字段需针对目标版本实跑",
    "本报告未修改 docs/research/maven-parameter-semantics-audit.md，因为运行时指定 research.md 为权威输出路径"
  ],
  "noStagedFiles": true,
  "diffSummary": "仅生成研究报告 research.md，未修改生产代码",
  "reviewFindings": [
    "P0: plugins/mvn-output/src/command.ts 未处理 -fn、测试跳过/忽略和报告配置，可能把 exit 0 的未验证结果显示为 PASS",
    "P0: plugins/mvn-output/src/summary.ts 仅累加文本 Tests run，无法可靠处理并行、重试、部分 reactor 和重复摘要",
    "P1: plugins/mvn-output/src/executor.ts 合并 stdout/stderr 且未区分 -l 用户日志与插件日志"
  ],
  "manualNotes": "建议维护者提供 mvn-lite 的确切 URL/commit，并按报告中的 fake Maven/真实项目矩阵补充验证"
}
```

/** Maven 工具的领域类型定义 */

/** Maven 工具支持的输出模式 */
export type MavenOutputMode = "compact" | "full";

/** Maven 执行结果的证据状态 */
export type MavenResultStatus = "passed" | "failed" | "not-run" | "passed-with-flakes" | "incomplete" | "unknown";

/** Maven 参数对结果可信度的影响 */
export interface MavenArgumentAnalysis {
  /** 是否使用 fail-never */
  failNever: boolean;
  /** 是否忽略测试失败 */
  testFailureIgnore: boolean;
  /** 是否跳过测试执行 */
  skipTests: boolean;
  /** 是否跳过测试编译和执行 */
  skipAllTests: boolean;
  /** 是否跳过集成测试 */
  skipIntegrationTests: boolean;
  /** 是否指定了测试筛选 */
  selectedTests?: string;
  /** 是否指定了集成测试筛选 */
  selectedIntegrationTests?: string;
  /** 是否允许指定测试为空 */
  failIfNoSpecifiedTests?: boolean;
  /** 是否使用 quiet 输出 */
  quiet: boolean;
  /** 是否使用 debug 输出 */
  debug: boolean;
  /** 是否请求异常堆栈 */
  errors: boolean;
  /** Maven 用户日志文件 */
  userLogFile?: string;
  /** 是否离线执行 */
  offline: boolean;
  /** 是否强制更新 Snapshot */
  updateSnapshots: boolean;
  /** 是否禁止 Snapshot 更新 */
  noSnapshotUpdates: boolean;
  /** 是否禁用 XML 测试报告 */
  disableXmlReport: boolean;
  /** 自定义测试报告目录 */
  reportsDirectory?: string;
  /** 是否把测试输出重定向到文件 */
  redirectTestOutputToFile: boolean;
  /** 是否使用非递归构建 */
  nonRecursive: boolean;
  /** Reactor 项目筛选 */
  projects?: string;
  /** 是否构建所选项目的上游依赖 */
  alsoMake: boolean;
  /** 是否构建依赖所选项目的下游项目 */
  alsoMakeDependents: boolean;
  /** 是否从指定模块恢复 */
  resumeFrom?: string;
  /** Reactor 失败策略 */
  reactorFailureMode?: "fail-fast" | "fail-at-end" | "fail-never";
  /** Reactor 并行线程参数 */
  threads?: string;
  /** 是否配置失败测试重试 */
  rerunFailingTestsCount?: number;
  /** flaky 测试失败阈值 */
  failOnFlakeCount?: number;
  /** 达到失败数后提前停止 */
  skipAfterFailureCount?: number;
  /** 本次参数带来的诊断提示 */
  notices: string[];
}

/** Maven 测试统计 */
export interface MavenTestCounts {
  /** 执行的测试数 */
  tests: number;
  /** 断言失败数 */
  failures: number;
  /** 测试错误数 */
  errors: number;
  /** 跳过数 */
  skipped: number;
}

/** Maven 工具的调用参数 */
export interface MavenToolParams {
  /** Maven 参数数组 */
  args: string[];
  /** 输出模式 */
  mode?: MavenOutputMode;
  /** 子进程超时时间 */
  timeoutMs?: number;
}

/** Maven 子进程的执行结果 */
export interface MavenExecutionResult {
  /** 实际执行的参数 */
  args: string[];
  /** 实际使用的可执行文件 */
  executable: string;
  /** Maven 工作目录 */
  cwd: string;
  /** 进程结束状态 */
  status: "completed" | "spawn-error" | "aborted" | "timeout";
  /** Maven 退出码 */
  exitCode: number | null;
  /** Maven 收到的终止信号 */
  signal: NodeJS.Signals | null;
  /** 合并后的输出内容 */
  output: string;
  /** 执行耗时 */
  durationMs: number;
  /** 完整日志路径 */
  logPath: string;
  /** 启动或解析错误 */
  errorMessage?: string;
}

/** Maven 摘要中的错误分类 */
export type MavenFindingKind =
  | "invocation"
  | "maven-cli"
  | "pom"
  | "dependency"
  | "plugin"
  | "compiler"
  | "test"
  | "reactor"
  | "warning"
  | "unknown";

/** Maven 摘要中的单条诊断 */
export interface MavenFinding {
  /** 诊断类别 */
  kind: MavenFindingKind;
  /** 诊断文本 */
  message: string;
}

/** Maven 工具返回的结构化详情 */
export interface MavenToolDetails {
  /** 摘要状态 */
  status: MavenResultStatus;
  /** Maven 退出码 */
  exitCode: number | null;
  /** Maven 收到的终止信号 */
  signal: NodeJS.Signals | null;
  /** 执行耗时 */
  durationMs: number;
  /** 实际使用的可执行文件 */
  executable: string;
  /** 实际执行的参数 */
  args: string[];
  /** Maven 工作目录 */
  cwd: string;
  /** 完整日志路径 */
  logPath: string;
  /** 分类后的诊断 */
  findings: MavenFinding[];
  /** 测试报告目录 */
  reportPaths: string[];
  /** warning 数量 */
  warningCount: number;
  /** 参数语义分析 */
  argumentAnalysis: MavenArgumentAnalysis;
  /** 从日志提取的测试统计 */
  testCounts?: MavenTestCounts;
  /** 解析器警告 */
  parserWarning?: string;
}

/** Maven 文本摘要结果 */
export interface MavenSummary {
  /** 摘要状态 */
  status: MavenResultStatus;
  /** 供 AI 阅读的摘要文本 */
  text: string;
  /** 供程序消费的结构化详情 */
  details: MavenToolDetails;
}

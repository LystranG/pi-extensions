/** Maven 工具的领域类型定义 */

/** Maven 工具支持的输出模式 */
export type MavenOutputMode = "compact" | "full";

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
  status: "passed" | "failed";
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
  /** 解析器警告 */
  parserWarning?: string;
}

/** Maven 文本摘要结果 */
export interface MavenSummary {
  /** 摘要状态 */
  status: "passed" | "failed";
  /** 供 AI 阅读的摘要文本 */
  text: string;
  /** 供程序消费的结构化详情 */
  details: MavenToolDetails;
}

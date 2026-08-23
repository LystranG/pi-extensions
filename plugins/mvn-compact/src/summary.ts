/** Maven 文本输出的确定性摘要策略 */

import {
  FALLBACK_HEAD_LINES,
  FALLBACK_TAIL_LINES,
  MAX_FINDINGS,
  MAX_FINDINGS_PER_KIND,
  MAX_SUMMARY_BYTES,
} from "./constants.ts";
import { analyzeMavenArguments } from "./options.ts";
import type {
  MavenExecutionResult,
  MavenFinding,
  MavenFindingKind,
  MavenResultStatus,
  MavenSummary,
  MavenTestCounts,
  MavenToolDetails,
} from "./types.ts";

const FINDING_PRIORITY: MavenFindingKind[] = [
  "invocation",
  "maven-cli",
  "pom",
  "dependency",
  "plugin",
  "compiler",
  "test",
  "reactor",
  "warning",
  "unknown",
];
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const NULL_CHARACTER = new RegExp(String.fromCharCode(0), "g");

/** 移除终端控制序列并把覆盖行转换为普通文本 */
export function normalizeMavenOutput(output: string): string {
  return output
    .replace(ANSI_ESCAPE, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(NULL_CHARACTER, "");
}

/** 移除 Maven 日志级别前缀并压缩无意义空白 */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*\[(?:INFO|WARNING|WARN|ERROR|DEBUG)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 把文本裁剪到有效 UTF-8 字节边界 */
function limitBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return `${Buffer.from(text, "utf8")
    .subarray(0, maxBytes - 32)
    .toString("utf8")
    .trimEnd()}\n[summary truncated]`;
}

/** 从 Maven 文本中提取总耗时 */
function extractTotalTime(lines: readonly string[]): string | undefined {
  const matches = lines
    .map((line) => line.match(/Total time:\s*(.+)$/i)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return matches.at(-1);
}

/** 从 Maven 文本中聚合 Surefire/Failsafe 测试计数 */
function extractTestCounts(lines: readonly string[]): MavenTestCounts | undefined {
  const totals: MavenTestCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let found = false;
  for (const line of lines) {
    const match = line.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
    if (!match) continue;
    found = true;
    totals.tests += Number(match[1]);
    totals.failures += Number(match[2]);
    totals.errors += Number(match[3]);
    totals.skipped += Number(match[4]);
  }
  return found ? totals : undefined;
}

/** 格式化测试计数摘要 */
function formatTestCounts(counts: MavenTestCounts | undefined): string | undefined {
  if (!counts) return undefined;
  return `${counts.tests} tests, ${counts.failures} failures, ${counts.errors} errors, ${counts.skipped} skipped`;
}

/** 判断命令参数是否包含可能执行测试的 Maven 阶段 */
function hasTestPhase(args: readonly string[]): boolean {
  const lifecyclePhases = new Set(["test", "verify", "package", "install", "deploy", "integration-test"]);
  const testGoals = new Set(["test", "integration-test", "verify"]);
  return args.some((argument) => {
    if (lifecyclePhases.has(argument)) return true;
    const goal = argument.split(":").at(-1);
    return argument.includes(":") && goal !== undefined && testGoals.has(goal);
  });
}

/** 构造参数语义提示 */
function formatArgumentNotices(notices: readonly string[]): string {
  if (notices.length === 0) return "";
  return ["Maven notices:", ...notices.map((notice) => `- ${notice}`)].join("\n");
}

/** 对可能包含凭据的 Maven 参数做最小脱敏 */
function redactArgument(argument: string): string {
  if (!/(?:password|passphrase|token|secret|api[-_.]?key|access[-_.]?key)/i.test(argument)) return argument;
  const separator = argument.indexOf("=");
  return separator >= 0 ? `${argument.slice(0, separator + 1)}<redacted>` : "<redacted>";
}

/** 构造供 AI 读取的执行元数据 */
export function formatExecutionMetadata(
  result: Pick<MavenExecutionResult, "args" | "executable" | "exitCode" | "logPath">,
): string {
  return [
    "Maven execution:",
    `- Executable: ${result.executable}`,
    `- Args: ${result.args.map(redactArgument).join(" ")}`,
    `- Exit code: ${result.exitCode ?? "none"}`,
    `- Full log: ${result.logPath}`,
  ].join("\n");
}

/** 对 Maven 错误行进行分类和去重 */
function collectFindings(lines: readonly string[]): MavenFinding[] {
  const findings: MavenFinding[] = [];
  const counts = new Map<MavenFindingKind, number>();
  const seen = new Set<string>();

  const add = (kind: MavenFindingKind, message: string): void => {
    const cleaned = cleanLine(message);
    if (!cleaned || cleaned === "------------------------------------------------------------------------") return;
    const key = `${kind}:${cleaned}`;
    if (seen.has(key)) return;
    if ((counts.get(kind) ?? 0) >= MAX_FINDINGS_PER_KIND || findings.length >= MAX_FINDINGS) return;
    seen.add(key);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    findings.push({ kind, message: cleaned.replace(/\s+->\s*\[Help \d+\]\s*$/i, "") });
  };

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    if (/Unknown lifecycle phase|No plugin found for prefix|Unrecognized option|option .* requires/i.test(line)) {
      add("maven-cli", line);
    } else if (/Non-resolvable parent POM|Some problems were encountered while processing the POMs/i.test(line)) {
      add("pom", line);
    } else if (
      /Could not (resolve|find|transfer) (?:dependencies|artifact)|checksum|Failed to collect dependencies/i.test(line)
    ) {
      add("dependency", line);
    } else if (/Failed to execute goal|MojoFailureException|MojoExecutionException/i.test(line)) {
      add("plugin", line);
    } else if (/\.(?:java|kt|groovy):\[\d+,\d+\]/i.test(line) || /cannot find symbol|compilation failure/i.test(line)) {
      add("compiler", line);
    } else if (/(?:<<< (?:FAILURE|ERROR)!)|Tests run:.*(?:Failures:|Errors:)/i.test(line)) {
      add("test", line);
    } else if (/Reactor Summary|Reactor Build Order|^\S.*\s+(SUCCESS|FAILURE|SKIPPED)\s+\d/i.test(line)) {
      add("reactor", line);
    } else if (/^\[WARNING\]|^WARNING\b/i.test(rawLine)) {
      add("warning", line);
    }
  }

  return findings.sort((left, right) => FINDING_PRIORITY.indexOf(left.kind) - FINDING_PRIORITY.indexOf(right.kind));
}

/** 构造未知失败的有界头尾回退 */
function fallbackText(lines: readonly string[]): string {
  const head = lines.slice(0, FALLBACK_HEAD_LINES);
  const tail = lines.length > FALLBACK_HEAD_LINES ? lines.slice(-FALLBACK_TAIL_LINES) : [];
  const unique = [...new Set([...head, ...tail].map(cleanLine).filter(Boolean))];
  return ["UNKNOWN_OUTPUT", "", "Log excerpt:", ...unique].join("\n");
}

/** 将 Maven 执行结果转换为供 AI 阅读的确定性摘要 */
export function summarizeMavenOutput(
  result: Pick<
    MavenExecutionResult,
    | "args"
    | "exitCode"
    | "signal"
    | "cwd"
    | "executable"
    | "durationMs"
    | "logPath"
    | "output"
    | "status"
    | "errorMessage"
  > & { stderr?: string; reportPaths?: string[] },
): MavenSummary {
  const normalized = normalizeMavenOutput(`${result.output}${result.stderr ?? ""}`);
  const lines = normalized.split(/\n/);
  const findings = [
    ...(result.status !== "completed" || result.errorMessage
      ? [
          {
            kind: "invocation" as const,
            message: result.errorMessage ?? `Maven process ended with status ${result.status}`,
          },
        ]
      : []),
    ...collectFindings(lines),
  ].slice(0, MAX_FINDINGS);
  const reportPaths = result.reportPaths ?? [];
  const totalTime = extractTotalTime(lines) ?? `${(result.durationMs / 1000).toFixed(1)} s`;
  const testCounts = extractTestCounts(lines);
  const argumentAnalysis = analyzeMavenArguments(result.args);
  const testFailuresDetected = Boolean(testCounts && (testCounts.failures > 0 || testCounts.errors > 0));
  const noTestsDetected = /No tests (?:to run|were executed|to execute)|No tests were found/i.test(normalized);
  const flakyTestsDetected =
    Boolean(
      (argumentAnalysis.rerunFailingTestsCount && argumentAnalysis.rerunFailingTestsCount > 0) ||
        argumentAnalysis.failOnFlakeCount !== undefined,
    ) && /(?:flak|rerun|re-run)/i.test(normalized);
  const incompleteTestsDetected =
    Boolean(argumentAnalysis.skipAfterFailureCount && argumentAnalysis.skipAfterFailureCount > 0) &&
    /(?:skip(?:ping)? further tests|skipAfterFailureCount)/i.test(normalized);
  const testPhaseRequested = hasTestPhase(result.args);
  const buildFailureDetected =
    /BUILD FAILURE|There are test failures|Failed to execute goal|Reactor Summary:.*FAILURE/i.test(normalized);
  const noSpecifiedTestsFailure =
    Boolean(argumentAnalysis.selectedTests || argumentAnalysis.selectedIntegrationTests) &&
    argumentAnalysis.failIfNoSpecifiedTests === true &&
    testCounts?.tests === 0;
  const warningCount = lines.filter((line) => /^\s*\[(?:WARNING|WARN)\]/i.test(line)).length;
  const failureIgnoredByMaven =
    result.exitCode === 0 && (argumentAnalysis.failNever || argumentAnalysis.testFailureIgnore) && buildFailureDetected;
  const failed =
    result.status !== "completed" ||
    result.exitCode !== 0 ||
    testFailuresDetected ||
    failureIgnoredByMaven ||
    noSpecifiedTestsFailure;
  let status: MavenResultStatus;
  if (failed) {
    status = "failed";
  } else if (
    testPhaseRequested &&
    !testFailuresDetected &&
    !noSpecifiedTestsFailure &&
    !failureIgnoredByMaven &&
    (argumentAnalysis.skipAllTests || argumentAnalysis.skipTests || argumentAnalysis.skipIntegrationTests) &&
    (testCounts === undefined || testCounts.tests === 0)
  ) {
    status = "not-run";
  } else if (testPhaseRequested && (noTestsDetected || (testCounts?.tests === 0 && argumentAnalysis.selectedTests))) {
    status = "not-run";
  } else if (incompleteTestsDetected) {
    status = "incomplete";
  } else if (flakyTestsDetected && !testFailuresDetected) {
    status = "passed-with-flakes";
  } else if (testPhaseRequested && !testCounts && !noTestsDetected) {
    status = "unknown";
  } else {
    status = "passed";
  }
  const details: MavenToolDetails = {
    status,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    executable: result.executable,
    args: [...result.args],
    cwd: result.cwd,
    logPath: result.logPath,
    findings,
    reportPaths,
    warningCount,
    argumentAnalysis,
    ...(testCounts ? { testCounts } : {}),
    ...(result.errorMessage ? { parserWarning: result.errorMessage } : {}),
  };

  if (status === "passed" || status === "passed-with-flakes") {
    const suffix = [formatTestCounts(testCounts), warningCount > 0 ? `${warningCount} warnings` : undefined]
      .filter(Boolean)
      .join(", ");
    const statusLabel = status === "passed-with-flakes" ? "PASS_WITH_FLAKES" : "PASS";
    return {
      status,
      text: limitBytes(
        [
          `${statusLabel}${suffix ? ` · ${suffix}` : ""} · ${totalTime}`,
          formatArgumentNotices(argumentAnalysis.notices),
          formatExecutionMetadata(result),
        ]
          .filter(Boolean)
          .join("\n\n"),
        MAX_SUMMARY_BYTES,
      ),
      details,
    };
  }

  const findingText = findings.length
    ? [
        "Failure summary:",
        ...findings.map(
          (finding) => `- ${finding.kind.charAt(0).toUpperCase()}${finding.kind.slice(1)}: ${finding.message}`,
        ),
      ].join("\n")
    : status === "unknown" || status === "failed"
      ? fallbackText(lines)
      : status === "not-run"
        ? "No tests were executed."
        : "No structured failure details were detected.";
  const reportsText = reportPaths.length ? `\n\nReports:\n${reportPaths.map((path) => `- ${path}`).join("\n")}` : "";
  const statusText =
    (testFailuresDetected || failureIgnoredByMaven || noSpecifiedTestsFailure) && result.exitCode === 0
      ? `FAIL · tests reported ${testCounts?.failures ?? 0} failures and ${testCounts?.errors ?? 0} errors (Maven exit code 0)`
      : status === "not-run"
        ? "NOT_RUN · no tests were executed"
        : status === "incomplete"
          ? "INCOMPLETE · test execution did not finish"
          : status === "unknown"
            ? "UNKNOWN · Maven completed without sufficient test evidence"
            : `FAIL · ${result.exitCode === null ? result.status : `exit code ${result.exitCode}`}`;
  const text = [
    statusText,
    formatArgumentNotices(argumentAnalysis.notices),
    findingText,
    reportsText,
    formatExecutionMetadata(result),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { status, text: limitBytes(text, MAX_SUMMARY_BYTES), details };
}

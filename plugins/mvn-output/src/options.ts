/** Maven 参数语义分析 */

import type { MavenArgumentAnalysis } from "./types.ts";

const BOOLEAN_TRUE = new Set(["", "true", "yes", "on", "1"]);
const BOOLEAN_FALSE = new Set(["false", "no", "off", "0"]);

/** 读取 Maven user property，支持 `-Dkey=value` 和 `-D key=value` */
function readProperty(args: readonly string[], key: string): string | undefined {
  for (let index = args.length - 1; index >= 0; index--) {
    const argument = args[index] ?? "";
    const nextArgument = args[index + 1];
    if (argument === `-D${key}`) return "";
    if (argument === `-D` && nextArgument?.startsWith(`${key}=`)) {
      return nextArgument.slice(key.length + 1);
    }
    if (argument.startsWith(`-D${key}=`)) return argument.slice(key.length + 3);
  }
  return undefined;
}

/** 读取 Maven boolean user property */
function readBooleanProperty(args: readonly string[], keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = readProperty(args, key);
    if (value === undefined) return false;
    if (BOOLEAN_FALSE.has(value.toLowerCase())) return false;
    return BOOLEAN_TRUE.has(value.toLowerCase()) || value.length === 0;
  });
}

/** 读取带独立值或等号值的 Maven CLI 参数 */
function readOptionValue(args: readonly string[], options: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? "";
    for (const option of options) {
      if (argument === option) return args[index + 1];
      if (argument.startsWith(`${option}=`)) return argument.slice(option.length + 1);
    }
  }
  return undefined;
}

/** 读取非负整数 user property */
function readNumberProperty(args: readonly string[], keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readProperty(args, key);
    if (value === undefined || !/^\d+$/.test(value)) continue;
    return Number(value);
  }
  return undefined;
}

/** 分析不应被 compact 模式忽略的 Maven 参数语义 */
export function analyzeMavenArguments(args: readonly string[]): MavenArgumentAnalysis {
  const selectedTests = readProperty(args, "test");
  const selectedIntegrationTests = readProperty(args, "it.test");
  const failIfNoSpecifiedTestsValue =
    readProperty(args, "surefire.failIfNoSpecifiedTests") ?? readProperty(args, "failsafe.failIfNoSpecifiedTests");
  const failIfNoSpecifiedTests =
    failIfNoSpecifiedTestsValue === undefined ? undefined : !BOOLEAN_FALSE.has(failIfNoSpecifiedTestsValue);
  const failNever = args.some((argument) => argument === "-fn" || argument === "--fail-never");
  const failAtEnd = args.some((argument) => argument === "-fae" || argument === "--fail-at-end");
  const failFast = args.some((argument) => argument === "-ff" || argument === "--fail-fast");
  const userLogFile = readOptionValue(args, ["-l", "--log-file"]);
  const projects = readOptionValue(args, ["-pl", "--projects"]);
  const resumeFrom = readOptionValue(args, ["-rf", "--resume-from"]);
  const threads = readOptionValue(args, ["-T", "--threads"]);
  const reportsDirectory =
    readProperty(args, "surefire.reportsDirectory") ?? readProperty(args, "failsafe.reportsDirectory");
  const rerunFailingTestsCount = readNumberProperty(args, [
    "surefire.rerunFailingTestsCount",
    "failsafe.rerunFailingTestsCount",
  ]);
  const failOnFlakeCount = readNumberProperty(args, ["surefire.failOnFlakeCount", "failsafe.failOnFlakeCount"]);
  const skipAfterFailureCount = readNumberProperty(args, [
    "surefire.skipAfterFailureCount",
    "failsafe.skipAfterFailureCount",
  ]);
  const notices: string[] = [];

  const analysis: MavenArgumentAnalysis = {
    failNever,
    testFailureIgnore: readBooleanProperty(args, [
      "testFailureIgnore",
      "maven.test.failure.ignore",
      "surefire.testFailureIgnore",
      "failsafe.testFailureIgnore",
    ]),
    skipTests: readBooleanProperty(args, ["skipTests", "surefire.skip", "failsafe.skip"]),
    skipAllTests: readBooleanProperty(args, ["maven.test.skip"]),
    skipIntegrationTests: readBooleanProperty(args, ["skipITs", "failsafe.skipITs"]),
    ...(selectedTests !== undefined ? { selectedTests } : {}),
    ...(selectedIntegrationTests !== undefined ? { selectedIntegrationTests } : {}),
    ...(failIfNoSpecifiedTests !== undefined ? { failIfNoSpecifiedTests } : {}),
    quiet: args.some((argument) => argument === "-q" || argument === "--quiet"),
    debug: args.some((argument) => argument === "-X" || argument === "--debug"),
    errors: args.some((argument) => argument === "-e" || argument === "--errors"),
    ...(userLogFile ? { userLogFile } : {}),
    offline: args.some((argument) => argument === "-o" || argument === "--offline"),
    updateSnapshots: args.some((argument) => argument === "-U" || argument === "--update-snapshots"),
    noSnapshotUpdates: args.some((argument) => argument === "-nsu" || argument === "--no-snapshot-updates"),
    disableXmlReport: readBooleanProperty(args, ["surefire.disableXmlReport", "failsafe.disableXmlReport"]),
    ...(reportsDirectory ? { reportsDirectory } : {}),
    redirectTestOutputToFile: readBooleanProperty(args, [
      "surefire.redirectTestOutputToFile",
      "failsafe.redirectTestOutputToFile",
    ]),
    nonRecursive: args.some((argument) => argument === "-N" || argument === "--non-recursive"),
    ...(projects ? { projects } : {}),
    alsoMake: args.some((argument) => argument === "-am" || argument === "--also-make"),
    alsoMakeDependents: args.some((argument) => argument === "-amd" || argument === "--also-make-dependents"),
    ...(resumeFrom ? { resumeFrom } : {}),
    ...(threads ? { threads } : {}),
    ...(failNever || failAtEnd || failFast
      ? {
          reactorFailureMode: failNever
            ? ("fail-never" as const)
            : failAtEnd
              ? ("fail-at-end" as const)
              : ("fail-fast" as const),
        }
      : {}),
    ...(rerunFailingTestsCount !== undefined ? { rerunFailingTestsCount } : {}),
    ...(failOnFlakeCount !== undefined ? { failOnFlakeCount } : {}),
    ...(skipAfterFailureCount !== undefined ? { skipAfterFailureCount } : {}),
    notices,
  };

  if (analysis.quiet) notices.push("quiet output may hide test statistics");
  if (analysis.debug) notices.push("debug output is enabled");
  if (analysis.errors) notices.push("expanded Maven error output is enabled");
  if (analysis.userLogFile) notices.push(`Maven also writes build output to ${analysis.userLogFile}`);
  if (analysis.offline) notices.push("offline dependency resolution is enabled");
  if (analysis.updateSnapshots) notices.push("Snapshot updates are forced");
  if (analysis.noSnapshotUpdates) notices.push("Snapshot updates are disabled");
  if (analysis.disableXmlReport) notices.push("XML test reports are disabled");
  if (analysis.reportsDirectory) notices.push(`custom test report directory: ${analysis.reportsDirectory}`);
  if (analysis.redirectTestOutputToFile) notices.push("test output is redirected to files");
  if (analysis.nonRecursive) notices.push("non-recursive reactor build is enabled");
  if (analysis.projects) notices.push(`reactor projects are limited to ${analysis.projects}`);
  if (analysis.alsoMake) notices.push("upstream reactor projects are included");
  if (analysis.alsoMakeDependents) notices.push("downstream reactor projects are included");
  if (analysis.resumeFrom) notices.push(`reactor resumes from ${analysis.resumeFrom}`);
  if (analysis.threads) notices.push(`parallel reactor threads: ${analysis.threads}`);
  if (analysis.reactorFailureMode) notices.push(`reactor failure mode: ${analysis.reactorFailureMode}`);
  if (analysis.failNever) notices.push("fail-never may keep Maven exit code at 0 after a build failure");
  if (analysis.testFailureIgnore) notices.push("test failures are configured to be ignored by Maven");
  if (analysis.skipAllTests) notices.push("test compilation and execution are skipped");
  else if (analysis.skipTests) notices.push("test execution is skipped");
  if (analysis.skipIntegrationTests) notices.push("integration tests are skipped");
  if (analysis.selectedTests || analysis.selectedIntegrationTests)
    notices.push("only selected tests are being executed");
  if (analysis.rerunFailingTestsCount && analysis.rerunFailingTestsCount > 0) {
    notices.push("failing tests may be retried");
  }
  if (analysis.skipAfterFailureCount && analysis.skipAfterFailureCount > 0) {
    notices.push("test execution may stop before all tests run");
  }
  return analysis;
}

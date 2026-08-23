/** Maven 命令参数和可执行文件策略 */

import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import type { MavenOutputMode } from "./types.ts";

const INFORMATION_FLAGS = new Set(["-h", "--help", "-v", "--version", "-V", "--show-version"]);
const REPORT_GOALS = new Set([
  "dependency:tree",
  "dependency:analyze",
  "site",
  "failsafe-report-only",
  "surefire-report:report",
  "surefire-report:failsafe",
]);

/** 判断 Maven 参数是否已经指定了批处理模式 */
function hasBatchMode(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-B" || arg === "--batch-mode");
}

/** 判断 Maven 参数是否已经关闭传输进度 */
function hasNoTransferProgress(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-ntp" || arg === "--no-transfer-progress");
}

/** 判断 Maven 参数是否已经指定了颜色策略 */
function hasColorMode(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      arg.startsWith("-Dstyle.color=") ||
      arg.startsWith("-Dstyle.color") ||
      arg.startsWith("--color=") ||
      arg === "--color",
  );
}

/** 判断 Maven 参数是否属于信息或报告请求 */
export function shouldUseFullOutput(args: readonly string[]): boolean {
  return args.some((arg) => {
    if (INFORMATION_FLAGS.has(arg)) return true;
    if (arg.startsWith("-")) return false;
    if (arg.startsWith("help:")) return true;
    return REPORT_GOALS.has(arg);
  });
}

/** 根据输出模式构造不改变用户参数语义的 Maven 参数 */
export function buildMavenArguments(args: readonly string[], mode: MavenOutputMode): string[] {
  if (mode === "full" || shouldUseFullOutput(args)) return [...args];

  const injected: string[] = [];
  if (!hasBatchMode(args)) injected.push("-B");
  if (!hasNoTransferProgress(args)) injected.push("-ntp");
  if (!hasColorMode(args)) injected.push("-Dstyle.color=never");
  return [...injected, ...args];
}

/** 选择当前项目的 Maven wrapper 或 PATH 中的 Maven */
export function resolveMavenExecutable(cwd: string): string {
  const wrapper = join(cwd, "mvnw");
  try {
    accessSync(wrapper, constants.X_OK);
    return wrapper;
  } catch {
    return "mvn";
  }
}

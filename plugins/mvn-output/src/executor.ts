/** Maven 子进程执行和日志生命周期 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMavenArguments, resolveMavenExecutable, shouldUseFullOutput } from "./command.ts";
import { DEFAULT_LOG_DIRECTORY, DEFAULT_TIMEOUT_MS } from "./constants.ts";
import { discoverMavenReportPaths } from "./reports.ts";
import { summarizeMavenOutput } from "./summary.ts";
import type { MavenExecutionResult, MavenOutputMode, MavenSummary } from "./types.ts";

/** 为 Maven 执行创建私有日志文件 */
async function createLogPath(cwd: string): Promise<string> {
  const directory = join(cwd, DEFAULT_LOG_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `maven-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.log`;
  const path = join(directory, filename);
  await writeFile(path, "", { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

/** 运行 Maven 并把两个输出通道写入完整日志 */
export async function runMaven(
  cwd: string,
  args: readonly string[],
  mode: MavenOutputMode,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<MavenExecutionResult> {
  const executable = resolveMavenExecutable(cwd);
  const finalArgs = buildMavenArguments(args, mode);
  const logPath = await createLogPath(cwd);
  const startedAt = Date.now();
  const logStream = createWriteStream(logPath, { flags: "a" });
  let output = "";
  let childSignal: NodeJS.Signals | null = null;
  let status: MavenExecutionResult["status"] = "completed";
  let errorMessage: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = await new Promise<{ exitCode: number | null }>((resolve) => {
    const child = spawn(executable, finalArgs, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;

    const stop = (nextStatus: MavenExecutionResult["status"]): void => {
      if (settled) return;
      status = nextStatus;
      child.kill("SIGTERM");
    };
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      logStream.write(chunk);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => {
      errorMessage = error.message;
      status = "spawn-error";
    });
    child.once("close", (exitCode, receivedSignal) => {
      if (settled) return;
      settled = true;
      childSignal = receivedSignal;
      if (timer) clearTimeout(timer);
      logStream.end(() => resolve({ exitCode }));
    });

    if (timeoutMs > 0) timer = setTimeout(() => stop("timeout"), timeoutMs);
    if (signal) {
      if (signal.aborted) stop("aborted");
      else signal.addEventListener("abort", () => stop("aborted"), { once: true });
    }
  });

  const execution: MavenExecutionResult = {
    args: finalArgs,
    executable,
    cwd,
    status,
    exitCode: result.exitCode,
    signal: childSignal,
    output,
    durationMs: Date.now() - startedAt,
    logPath,
    ...(errorMessage ? { errorMessage } : {}),
  };
  return execution;
}

/** 执行 Maven 并根据模式返回摘要或完整输出 */
export async function executeMaven(
  cwd: string,
  args: readonly string[],
  mode: MavenOutputMode,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<MavenSummary | { status: "full"; text: string; execution: MavenExecutionResult }> {
  const effectiveMode = mode === "full" || shouldUseFullOutput(args) ? "full" : "compact";
  const execution = await runMaven(cwd, args, effectiveMode, timeoutMs, signal);
  if (effectiveMode === "full") {
    return {
      status: "full",
      text: await readFile(execution.logPath, "utf8"),
      execution,
    };
  }
  const reportPaths = await discoverMavenReportPaths(cwd);
  return summarizeMavenOutput({ ...execution, reportPaths });
}

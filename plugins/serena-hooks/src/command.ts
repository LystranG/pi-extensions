// 通过标准输入输出运行 Serena hook 命令

import { spawn } from "node:child_process";
import type {
  SerenaCommandExecutor,
  SerenaHookAction,
  SerenaHookExecutor,
  SerenaHookInput,
  SerenaHookResult,
} from "./types.ts";

const COMMAND = "serena-hooks";
const CLIENT = "claude-code";
const TIMEOUT_MS = 10_000;

export function createSerenaHookExecutor(exec: SerenaCommandExecutor): SerenaHookExecutor {
  return (action: SerenaHookAction, input: SerenaHookInput) =>
    exec(COMMAND, [action, "--client", CLIENT], { timeout: TIMEOUT_MS }, input);
}

export function runSerenaCommand(
  command: string,
  args: string[],
  options: { timeout: number },
  input: SerenaHookInput,
): Promise<SerenaHookResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killed = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, killed, stdout, stderr });
    };
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, options.timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin.end(JSON.stringify(input));
  });
}

import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND = "serena-hooks";
const CLIENT = "claude-code";
const TIMEOUT_MS = 10_000;

export type SerenaHookAction = "activate" | "remind" | "cleanup";
export type SerenaHookInput = Record<string, unknown>;

export interface SerenaHookResult {
  code: number | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export type SerenaHookExecutor = (action: SerenaHookAction, input: SerenaHookInput) => Promise<SerenaHookResult>;
export type SerenaHookWarning = (action: SerenaHookAction, detail: string) => void;
export type SerenaCommandExecutor = (
  command: string,
  args: string[],
  options: { timeout: number },
  input: SerenaHookInput,
) => Promise<SerenaHookResult>;

export function createSerenaHookExecutor(exec: SerenaCommandExecutor): SerenaHookExecutor {
  return (action, input) => exec(COMMAND, [action, "--client", CLIENT], { timeout: TIMEOUT_MS }, input);
}

export interface SerenaHookOutput {
  decision?: "deny" | "allow" | undefined;
  reason?: string | undefined;
  additionalContext?: string | undefined;
}

export function parseSerenaHookOutput(stdout: string | undefined): SerenaHookOutput | undefined {
  const text = stdout?.trim();
  if (!text) return undefined;

  try {
    const value = JSON.parse(text) as {
      decision?: "deny" | "allow";
      reason?: string;
      hookSpecificOutput?: {
        permissionDecision?: "deny" | "allow";
        permissionDecisionReason?: string;
        additionalContext?: string;
      };
    };
    const hookOutput = value.hookSpecificOutput;
    return {
      decision: value.decision ?? hookOutput?.permissionDecision,
      reason: value.reason ?? hookOutput?.permissionDecisionReason,
      additionalContext: hookOutput?.additionalContext,
    };
  } catch {
    return undefined;
  }
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, " ").trim().slice(0, 200) || "未知错误";
}

function resultFailure(result: SerenaHookResult): string | undefined {
  // 将外部命令失败转换为可读的单次警告
  if (result.code === 0 && !result.killed) return undefined;
  const stderr = result.stderr?.replaceAll(/\s+/g, " ").trim();
  if (stderr) return stderr.slice(0, 200);
  if (result.killed) return "命令超时或被终止";
  return `命令退出码为 ${result.code ?? "unknown"}`;
}

export class SerenaHooksController {
  readonly #execute: SerenaHookExecutor;
  readonly #warnedActions = new Set<SerenaHookAction>();

  constructor(execute: SerenaHookExecutor) {
    this.#execute = execute;
  }

  async sessionStart(sessionId: string, warn: SerenaHookWarning): Promise<SerenaHookResult | undefined> {
    this.#warnedActions.clear();
    return this.#run("activate", { session_id: sessionId }, warn);
  }

  async beforeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId: string,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    return this.#run("remind", { session_id: sessionId, tool_name: toolName, tool_input: toolInput }, warn);
  }

  async sessionShutdown(
    reason: string,
    sessionId: string,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    if (reason === "quit") return this.#run("cleanup", { session_id: sessionId }, warn);
    return undefined;
  }

  async #run(
    action: SerenaHookAction,
    input: SerenaHookInput,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    // 命令失败不阻断 Pi，但按动作去重提示
    let failure: string | undefined;
    let result: SerenaHookResult | undefined;
    try {
      result = await this.#execute(action, input);
      failure = resultFailure(result);
    } catch (error) {
      failure = errorDetail(error);
    }

    if (failure && !this.#warnedActions.has(action)) {
      this.#warnedActions.add(action);
      warn(action, failure);
    }
    return result;
  }
}

function warningFor(ctx: ExtensionContext): SerenaHookWarning {
  return (action, detail) => {
    if (ctx.hasUI) ctx.ui.notify(`${COMMAND} ${action} 失败：${detail}`, "warning");
  };
}

function runSerenaCommand(
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

export default function serenaHooksExtension(pi: ExtensionAPI): void {
  const controller = new SerenaHooksController(createSerenaHookExecutor(runSerenaCommand));

  pi.on("session_start", async (_event, ctx) => {
    const result = await controller.sessionStart(ctx.sessionManager.getSessionId(), warningFor(ctx));
    const output = parseSerenaHookOutput(result?.stdout);
    if (output?.additionalContext) {
      pi.sendMessage(
        {
          customType: "serena-hooks",
          content: output.additionalContext,
          display: true,
        },
        { deliverAs: "nextTurn" },
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const result = await controller.beforeTool(
      event.toolName,
      event.input,
      ctx.sessionManager.getSessionId(),
      warningFor(ctx),
    );
    const output = parseSerenaHookOutput(result?.stdout);
    if (output?.decision === "deny") {
      return { block: true, reason: output.reason ?? "Serena hook denied this tool call" };
    }
    return undefined;
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await controller.sessionShutdown(event.reason, ctx.sessionManager.getSessionId(), warningFor(ctx));
  });
}

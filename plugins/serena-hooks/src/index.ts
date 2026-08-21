import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND = "serena-hooks";
const TIMEOUT_MS = 10_000;

export type SerenaHookAction = "activate" | "remind" | "cleanup";

export interface SerenaHookResult {
  code: number | null;
  killed?: boolean;
  stderr?: string;
}

export type SerenaHookExecutor = (action: SerenaHookAction) => Promise<SerenaHookResult>;
export type SerenaHookWarning = (action: SerenaHookAction, detail: string) => void;
export type SerenaCommandExecutor = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<SerenaHookResult>;

export function createSerenaHookExecutor(exec: SerenaCommandExecutor): SerenaHookExecutor {
  return (action) => exec(COMMAND, [action], { timeout: TIMEOUT_MS });
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

  async sessionStart(warn: SerenaHookWarning): Promise<void> {
    this.#warnedActions.clear();
    await this.#run("activate", warn);
  }

  async beforeTool(toolName: string, warn: SerenaHookWarning): Promise<void> {
    if (toolName === "bash") await this.#run("remind", warn);
  }

  async sessionShutdown(reason: string, warn: SerenaHookWarning): Promise<void> {
    if (reason === "quit") await this.#run("cleanup", warn);
  }

  async #run(action: SerenaHookAction, warn: SerenaHookWarning): Promise<void> {
    // 命令失败不阻断 Pi，但按动作去重提示
    let failure: string | undefined;
    try {
      failure = resultFailure(await this.#execute(action));
    } catch (error) {
      failure = errorDetail(error);
    }

    if (!failure || this.#warnedActions.has(action)) return;
    this.#warnedActions.add(action);
    warn(action, failure);
  }
}

function warningFor(ctx: ExtensionContext): SerenaHookWarning {
  return (action, detail) => {
    if (ctx.hasUI) ctx.ui.notify(`${COMMAND} ${action} 失败：${detail}`, "warning");
  };
}

export default function serenaHooksExtension(pi: ExtensionAPI): void {
  const controller = new SerenaHooksController(
    createSerenaHookExecutor((command, args, options) => pi.exec(command, args, options)),
  );

  pi.on("session_start", async (_event, ctx) => {
    await controller.sessionStart(warningFor(ctx));
  });

  pi.on("tool_call", async (event, ctx) => {
    await controller.beforeTool(event.toolName, warningFor(ctx));
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await controller.sessionShutdown(event.reason, warningFor(ctx));
  });
}

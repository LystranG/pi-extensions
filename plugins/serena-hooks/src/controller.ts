// 编排 Serena hook 的生命周期、失败处理和工具过滤

import { shouldRunSerenaRemind } from "./tool-matcher.ts";
import type { SerenaHookAction, SerenaHookExecutor, SerenaHookResult, SerenaHookWarning } from "./types.ts";

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, " ").trim().slice(0, 200) || "未知错误";
}

function resultFailure(result: SerenaHookResult): string | undefined {
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
    if (!shouldRunSerenaRemind(toolName)) return undefined;
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
    input: Record<string, unknown>,
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

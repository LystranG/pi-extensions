// 编排 Serena hook 的生命周期、失败处理和工具过滤

import { normalizeSerenaRemindToolCall } from "./tool-matcher.ts";
import type { SerenaHookAction, SerenaHookExecutor, SerenaHookResult, SerenaHookWarning } from "./types.ts";

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/g, " ").trim().slice(0, 200) || "Unknown error";
}

function resultFailure(result: SerenaHookResult): string | undefined {
  if (result.code === 0 && !result.killed) return undefined;
  const stderr = result.stderr?.replaceAll(/\s+/g, " ").trim();
  if (stderr) return stderr.slice(0, 200);
  if (result.killed) return "Command timed out or was terminated";
  return `Command exited with code ${result.code ?? "unknown"}`;
}

// 需要清理 Serena hook 数据的会话结束原因；reload 之后仍会复用同一会话，因此排除
const CLEANUP_REASONS = new Set(["quit", "new", "resume", "fork"]);

export class SerenaHooksController {
  readonly #execute: SerenaHookExecutor;
  readonly #warnedActions = new Set<SerenaHookAction>();
  // 标记已经为即将到来的用户消息排队过一次回退激活，避免重复导航注入多份相同上下文
  #rewindActivationPending = false;

  constructor(execute: SerenaHookExecutor) {
    this.#execute = execute;
  }

  // 会话开始时激活 Serena 会话，并重置本次会话的告警去重与回退激活状态
  async sessionStart(sessionId: string, warn: SerenaHookWarning): Promise<SerenaHookResult | undefined> {
    this.#warnedActions.clear();
    this.#rewindActivationPending = false;
    return this.#run("activate", { session_id: sessionId }, warn);
  }

  // 会话树回退到首条用户消息之前时重新激活，让被截断的 Serena 上下文重新注入下一条用户消息
  async rewindActivate(
    sessionId: string,
    rewoundBeforeFirstUserMessage: boolean,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    if (!rewoundBeforeFirstUserMessage || this.#rewindActivationPending) return undefined;
    this.#rewindActivationPending = true;
    return this.#run("activate", { session_id: sessionId }, warn);
  }

  // 用户消息已经发出，之前排队的回退激活会被该轮消费，允许后续回退再次注入
  completeRewindActivation(): void {
    this.#rewindActivationPending = false;
  }

  async beforeTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId: string,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    const normalizedTool = normalizeSerenaRemindToolCall(toolName, toolInput);
    if (!normalizedTool) return undefined;
    return this.#run(
      "remind",
      { session_id: sessionId, tool_name: normalizedTool.toolName, tool_input: normalizedTool.toolInput },
      warn,
    );
  }

  async sessionShutdown(
    reason: string,
    sessionId: string,
    warn: SerenaHookWarning,
  ): Promise<SerenaHookResult | undefined> {
    if (!CLEANUP_REASONS.has(reason)) return undefined;
    return this.#run("cleanup", { session_id: sessionId }, warn);
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

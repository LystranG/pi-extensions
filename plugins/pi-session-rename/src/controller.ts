import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";
import { extractUserPrompt, isUserOriginatedInput, type TitleGenerationResult } from "./title.ts";

export interface RenameCandidate {
  /** 首个用户提示中由用户自己书写的内容 */
  prompt: string;
}

export interface SessionRenameControllerOptions {
  /** 读取当前 session 名称 */
  getSessionName: () => string | undefined;
  /** 写入自动生成的 session 名称 */
  setSessionName: (name: string) => void;
  /** 输出英文警告 */
  warn: (message: string) => void;
  /** 在独立请求中生成 session 名称 */
  generateTitle: (
    model: Model<Api>,
    modelRegistry: ExtensionContext["modelRegistry"],
    candidate: RenameCandidate,
    signal: AbortSignal,
  ) => Promise<TitleGenerationResult>;
}

/**
 * 管理首个用户提示的捕获、后台命名以及失败恢复
 * 候选项在 before_agent_start 阶段读取，那里才能拿到 skill 与 prompt template 展开后的文本
 */
export function createSessionRenameController(options: SessionRenameControllerOptions) {
  let candidate: RenameCandidate | undefined;
  let attempted = false;
  let turnFailed = false;
  let userTurnPending = false;
  let sessionGeneration = 0;
  let activeAbortController: AbortController | undefined;

  /** input：只记录本轮是否由用户发起，候选文本留给展开后的 before_agent_start 读取 */
  const onInput = (event: Pick<InputEvent, "source" | "streamingBehavior">): void => {
    if (attempted || candidate) return;
    userTurnPending = isUserOriginatedInput(event);
  };

  /** before_agent_start：取展开后的首个用户提示并立即发起后台命名请求 */
  const onBeforeAgentStart = (
    prompt: string,
    model: Model<Api> | undefined,
    modelRegistry: ExtensionContext["modelRegistry"] | undefined,
  ): void => {
    const wasUserTurn = userTurnPending;
    userTurnPending = false;
    if (!wasUserTurn || attempted || candidate) return;

    const userPrompt = extractUserPrompt(prompt);
    if (!userPrompt) return;
    if (!model || !modelRegistry) {
      // 不设置候选，后续 turn 仍有机会命名
      options.warn("Session title generation skipped because no model is available.");
      return;
    }

    candidate = { prompt: userPrompt };
    turnFailed = false;
    startRename(model, modelRegistry);
  };

  /** turn_end：跟踪首个 turn 是否失败，失败的 turn 不应该留下名字 */
  const onTurnEnd = (message: Pick<AssistantMessage, "role" | "stopReason">): void => {
    if (message.role !== "assistant") return;
    if (message.stopReason === "toolUse") return;

    if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "deferred") {
      turnFailed = true;
      return;
    }
    if (message.stopReason === "stop" || message.stopReason === "length") turnFailed = false;
  };

  const startRename = (model: Model<Api>, modelRegistry: ExtensionContext["modelRegistry"]): void => {
    if (attempted || !candidate || turnFailed || options.getSessionName() !== undefined) return;
    attempted = true;
    const request = candidate;
    const requestGeneration = sessionGeneration;
    const abortController = new AbortController();
    activeAbortController = abortController;
    void options
      .generateTitle(model, modelRegistry, request, abortController.signal)
      .then((result) => {
        if (
          abortController.signal.aborted ||
          requestGeneration !== sessionGeneration ||
          options.getSessionName() !== undefined
        ) {
          return;
        }
        if (result.title) {
          options.setSessionName(result.title);
        } else if (result.lengthLimitExceeded) {
          options.warn("Session title generation stopped after 3 retries because the title exceeded the length limit.");
        } else if (result.error) {
          options.warn(`Session title generation failed: ${result.error}`);
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        const detail = error instanceof Error ? error.message : String(error);
        options.warn(`Session title generation failed: ${detail}`);
      })
      .finally(() => {
        if (activeAbortController === abortController) activeAbortController = undefined;
      });
  };

  /**
   * agent_settled：递归重试结束后仍在失败的 turn，且请求尚未落地时丢弃候选
   * 这样被中断的首个 turn 不会留下名字，后续用户提示还能重新触发命名
   */
  const onAgentSettled = (): void => {
    if (!turnFailed) return;
    turnFailed = false;
    if (options.getSessionName() !== undefined) return;

    activeAbortController?.abort();
    activeAbortController = undefined;
    attempted = false;
    candidate = undefined;
  };

  const onSessionStart = (): void => {
    sessionGeneration++;
    activeAbortController?.abort();
    activeAbortController = undefined;
    candidate = undefined;
    attempted = false;
    turnFailed = false;
    userTurnPending = false;
  };

  const onSessionShutdown = (): void => {
    sessionGeneration++;
    activeAbortController?.abort();
    activeAbortController = undefined;
    candidate = undefined;
    turnFailed = false;
    userTurnPending = false;
  };

  return { onInput, onBeforeAgentStart, onTurnEnd, onAgentSettled, onSessionStart, onSessionShutdown };
}

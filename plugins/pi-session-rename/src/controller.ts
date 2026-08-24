import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";
import { isEligibleInput } from "./title.ts";

export interface RenameCandidate {
  /** 首个普通用户提示 */
  prompt: string;
}

export interface SessionRenameControllerOptions {
  /** 读取当前 session 名称 */
  getSessionName: () => string | undefined;
  /** 写入自动生成的 session 名称 */
  setSessionName: (name: string) => void;
  /** 在独立请求中生成 session 名称 */
  generateTitle: (
    model: Model<Api>,
    modelRegistry: ExtensionContext["modelRegistry"],
    candidate: RenameCandidate,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
}

/** 管理首次 turn 候选、失败恢复和后台重命名竞态 */
export function createSessionRenameController(options: SessionRenameControllerOptions) {
  let candidate: RenameCandidate | undefined;
  let attempted = false;
  let turnFailed = false;
  let sessionGeneration = 0;
  let activeAbortController: AbortController | undefined;

  const onInput = (event: Pick<InputEvent, "text" | "source" | "streamingBehavior">): void => {
    if (attempted || candidate || !isEligibleInput(event)) return;
    candidate = { prompt: event.text.trim() };
  };

  const onTurnEnd = (
    model: Model<Api> | undefined,
    modelRegistry: ExtensionContext["modelRegistry"],
    message: Pick<AssistantMessage, "role" | "stopReason">,
  ): void => {
    if (!candidate || message.role !== "assistant" || !model) return;

    if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "deferred") {
      turnFailed = true;
      return;
    }

    if (message.stopReason === "toolUse") return;
    if (message.stopReason !== "stop" && message.stopReason !== "length") return;
    turnFailed = false;
    startRename(model, modelRegistry);
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
      .then((title) => {
        if (
          abortController.signal.aborted ||
          requestGeneration !== sessionGeneration ||
          options.getSessionName() !== undefined
        ) {
          return;
        }
        if (title) options.setSessionName(title);
      })
      .catch(() => undefined)
      .finally(() => {
        if (activeAbortController === abortController) activeAbortController = undefined;
      });
  };

  const onAgentSettled = (): void => {
    if (candidate && turnFailed && !attempted) {
      candidate = undefined;
      turnFailed = false;
    }
  };

  const onSessionStart = (): void => {
    sessionGeneration++;
    activeAbortController?.abort();
    activeAbortController = undefined;
    candidate = undefined;
    attempted = false;
    turnFailed = false;
  };

  const onSessionShutdown = (): void => {
    sessionGeneration++;
    activeAbortController?.abort();
    activeAbortController = undefined;
    candidate = undefined;
    turnFailed = false;
  };

  return { onInput, onTurnEnd, onAgentSettled, onSessionStart, onSessionShutdown };
}

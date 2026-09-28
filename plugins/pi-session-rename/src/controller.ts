/** 协调首次自动命名与手动重命名，共用请求取消和结果提交保护 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";
import {
  extractCommandArguments,
  extractUserPrompt,
  isUserOriginatedInput,
  type TitleGenerationResult,
  type TitleSource,
} from "./title.ts";

export interface RenameCandidate {
  /** 首条用户提示或当前会话主线的文本快照 */
  prompt: string;
  /** 未指定时保持首句自动命名的输入契约 */
  source?: TitleSource;
}

export interface SessionRenameControllerOptions {
  /** 读取当前 session 名称 */
  getSessionName: () => string | undefined;
  /** 写入自动生成的 session 名称 */
  setSessionName: (name: string) => void;
  /** 输出英文警告 */
  warn: (message: string) => void;
  /** 手动命名的进度与完成提示 */
  info?: (message: string) => void;
  /** 在独立请求中生成 session 名称 */
  generateTitle: (
    model: Model<Api>,
    modelRegistry: ExtensionContext["modelRegistry"],
    candidate: RenameCandidate,
    signal: AbortSignal,
  ) => Promise<TitleGenerationResult>;
}

/** session_start 时交给控制器的会话状态 */
export interface SessionStartState {
  /** 会话里已经存在的用户消息条数；大于 0 说明这是恢复或分叉出来的会话 */
  existingUserMessages: number;
}

/**
 * 首次自动命名只捕获第一条可用用户提示，恢复会话不自动触发
 * 显式命名可重复执行并覆盖已有名称，始终以最新请求为准
 * 主对话中断不取消标题请求，会话替换、树跳转或新命名请求会使旧请求失效
 */
export function createSessionRenameController(options: SessionRenameControllerOptions) {
  let candidate: RenameCandidate | undefined;
  /** 本次 session 的命名机会是否已经用掉；已有历史的会话在 session_start 时即视为用掉 */
  let renameConsumed = false;
  let userTurnPending = false;
  /** 请求代次随显式命名或会话上下文替换递增，防止迟到结果提交 */
  let sessionGeneration = 0;
  let activeAbortController: AbortController | undefined;
  /** 命令展开前用户输入的原始文本，用于取回用户自己写下的命令参数 */
  let rawInputText: string | undefined;

  /** input：只记录本轮 turn 是否由用户发起，并留下命令展开前的原始文本 */
  const onInput = (event: Pick<InputEvent, "source" | "streamingBehavior" | "text">): void => {
    if (renameConsumed || candidate) return;
    userTurnPending = isUserOriginatedInput(event);
    rawInputText = userTurnPending ? event.text : undefined;
  };

  /** before_agent_start：取展开后的首个用户提示并立即发起后台命名请求 */
  const onBeforeAgentStart = (
    prompt: string,
    model: Model<Api> | undefined,
    modelRegistry: ExtensionContext["modelRegistry"] | undefined,
  ): void => {
    const wasUserTurn = userTurnPending;
    const rawInput = rawInputText;
    userTurnPending = false;
    rawInputText = undefined;
    if (!wasUserTurn || renameConsumed || candidate) return;

    // 提示模板与 skill 命令会被 Pi 展开后再交到这里，只有展开过的提示才回退到原始输入取参数；
    // 原样透传的命令保持原有语义，不作为命名依据
    const wasExpanded = rawInput !== undefined && prompt.trim() !== rawInput.trim();
    const expandedPrompt = extractUserPrompt(prompt);
    const commandArguments = wasExpanded ? extractCommandArguments(rawInput) : undefined;
    const userPrompt = commandArguments ?? expandedPrompt;
    if (!userPrompt) return;
    if (!model || !modelRegistry) {
      // 防御性分支：真实 Pi 在发出 before_agent_start 之前就会因缺少模型抛错，因此这里通常不会命中；
      // 不设置候选也不消耗机会，后续 turn 仍可命名
      options.warn("Session title generation skipped because no model is available.");
      return;
    }

    candidate = { prompt: userPrompt };
    startRename(model, modelRegistry);
  };

  /** 共用请求链，只有手动入口允许覆盖已有名称 */
  const startRename = (model: Model<Api>, modelRegistry: ExtensionContext["modelRegistry"], manual = false): void => {
    if (!candidate || (!manual && (renameConsumed || options.getSessionName() !== undefined))) return;
    renameConsumed = true;
    const request = candidate;
    const requestGeneration = sessionGeneration;
    const abortController = new AbortController();
    activeAbortController = abortController;
    if (manual) options.info?.("Generating session title...");
    void options
      .generateTitle(model, modelRegistry, request, abortController.signal)
      .then((result) => {
        if (
          abortController.signal.aborted ||
          requestGeneration !== sessionGeneration ||
          (!manual && options.getSessionName() !== undefined)
        )
          return;
        if (result.title) {
          options.setSessionName(result.title);
          if (manual) options.info?.(`Session renamed to: ${result.title}`);
        } else if (result.lengthLimitExceeded) {
          options.warn("Session title generation stopped because the title exceeded the length limit.");
        } else if (result.error) {
          options.warn(`Session title generation failed: ${result.error}`);
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted || requestGeneration !== sessionGeneration) return;
        const detail = error instanceof Error ? error.message : String(error);
        options.warn(`Session title generation failed: ${detail}`);
      })
      .finally(() => {
        if (activeAbortController === abortController) activeAbortController = undefined;
      });
  };

  /** 显式命名不受会话历史、已有名称或首次自动命名机会的限制 */
  const onManualRename = (
    prompt: string | undefined,
    model: Model<Api> | undefined,
    modelRegistry: ExtensionContext["modelRegistry"],
  ): void => {
    invalidatePendingRename();
    if (!prompt?.trim()) {
      options.warn("Session title generation skipped because no conversation context is available.");
      return;
    }
    if (!model) {
      options.warn("Session title generation skipped because no model is available.");
      return;
    }
    candidate = { prompt, source: "conversation" };
    startRename(model, modelRegistry, true);
  };

  /** session_start：重置状态，并让已有历史的会话从一开始就没有命名机会 */
  const onSessionStart = ({ existingUserMessages }: SessionStartState): void => {
    invalidatePendingRename();
    renameConsumed = existingUserMessages > 0;
  };

  /** 在访问任何 Pi 上下文前，用本地代次和取消信号使旧请求失效 */
  const invalidatePendingRename = (): void => {
    sessionGeneration++;
    activeAbortController?.abort();
    activeAbortController = undefined;
    candidate = undefined;
    userTurnPending = false;
    rawInputText = undefined;
  };

  return { onInput, onBeforeAgentStart, onManualRename, onSessionStart, onSessionShutdown: invalidatePendingRename };
}

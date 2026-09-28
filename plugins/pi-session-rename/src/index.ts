/** 注册首次自动命名与显式会话主线重命名 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildHeaderTransform } from "./adapters/index.ts";
import { createSessionRenameController } from "./controller.ts";
import { buildRenameContext, countUserMessages } from "./session-history.ts";
import { generateTitle } from "./title.ts";

/** 通过独立模型请求生成标题，不向主对话注入消息 */
export default function sessionRenameExtension(pi: ExtensionAPI): void {
  /** 当前上下文的提示投递函数，只在请求仍有效时调用 */
  let notify: ExtensionContext["ui"]["notify"] | undefined;
  /** 当前 session id；opencode 系 provider 依赖它做请求路由 */
  let sessionId: string | undefined;

  const controller = createSessionRenameController({
    getSessionName: () => pi.getSessionName(),
    setSessionName: (name) => pi.setSessionName(name),
    warn: (message) => notify?.(message, "warning"),
    info: (message) => notify?.(message, "info"),
    generateTitle: async (model, modelRegistry, candidate, signal) => {
      // 在请求开始时固定路由头，重试不能读到另一会话的标识
      const transformHeaders = buildHeaderTransform(model, sessionId);
      return generateTitle(
        model,
        candidate.prompt,
        signal,
        (requestModel, context, options) =>
          modelRegistry.complete(requestModel, context, transformHeaders ? { ...options, transformHeaders } : options),
        candidate.source,
      );
    },
  });
  pi.registerCommand("auto-rename", {
    description: "Rename this session from its current conversation using the selected model",
    handler: async (_args, ctx) => {
      notify = (message, type) => ctx.ui.notify(message, type);
      sessionId = ctx.sessionManager.getSessionId();
      const prompt = buildRenameContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
      controller.onManualRename(prompt, ctx.model, ctx.modelRegistry);
    },
  });

  /** 会话替换或树跳转会使旧标题失效，普通新增消息不触发此重置 */
  const onSessionContextChanged = (_event: unknown, ctx: ExtensionContext): void => {
    sessionId = ctx.sessionManager.getSessionId();
    controller.onSessionStart({ existingUserMessages: countUserMessages(ctx.sessionManager.getEntries()) });
  };
  pi.on("session_start", onSessionContextChanged);
  pi.on("session_tree", onSessionContextChanged);

  pi.on("input", (event) => controller.onInput(event));

  pi.on("before_agent_start", (event, ctx) => {
    notify = (message, type) => ctx.ui.notify(message, type);
    sessionId = ctx.sessionManager.getSessionId();
    controller.onBeforeAgentStart(event.prompt, ctx.model, ctx.modelRegistry);
  });

  pi.on("session_shutdown", () => controller.onSessionShutdown());
}

export * from "./adapters/index.ts";
export * from "./controller.ts";
export * from "./session-history.ts";
export * from "./title.ts";

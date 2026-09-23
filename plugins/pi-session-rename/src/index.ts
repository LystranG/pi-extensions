import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildHeaderTransform } from "./adapters/index.ts";
import { createSessionRenameController } from "./controller.ts";
import { countUserMessages } from "./session-history.ts";
import { generateTitle } from "./title.ts";

/** 注册首个用户 turn 开始后的后台 session 自动命名 */
export default function sessionRenameExtension(pi: ExtensionAPI): void {
  let warningMessage: ((message: string) => void) | undefined;
  /** 当前 session id；opencode 系 provider 依赖它做请求路由 */
  let sessionId: string | undefined;

  const controller = createSessionRenameController({
    getSessionName: () => pi.getSessionName(),
    setSessionName: (name) => pi.setSessionName(name),
    warn: (message) => warningMessage?.(message),
    generateTitle: async (model, modelRegistry, candidate, signal) => {
      return generateTitle(model, candidate.prompt, signal, (requestModel, context, options) => {
        // 扩展自己发起的请求绕过了 Pi 主循环的请求头装配，provider 需要的私有头由适配器补齐
        const transformHeaders = buildHeaderTransform(requestModel, sessionId);
        return modelRegistry.complete(
          requestModel,
          context,
          transformHeaders ? { ...options, transformHeaders } : options,
        );
      });
    },
  });

  pi.on("session_start", (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    // 已经带着用户消息的会话（pi -r / pi -c 恢复、分叉）不再自动命名
    controller.onSessionStart({ existingUserMessages: countUserMessages(ctx.sessionManager.getEntries()) });
  });

  pi.on("input", (event) => controller.onInput(event));

  pi.on("before_agent_start", (event, ctx) => {
    warningMessage = (message) => ctx.ui.notify(message, "warning");
    sessionId = ctx.sessionManager.getSessionId();
    controller.onBeforeAgentStart(event.prompt, ctx.model, ctx.modelRegistry);
  });

  pi.on("session_shutdown", () => controller.onSessionShutdown());
}

export * from "./adapters/index.ts";
export * from "./controller.ts";
export * from "./session-history.ts";
export * from "./title.ts";

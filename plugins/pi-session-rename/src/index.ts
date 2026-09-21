import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSessionRenameController } from "./controller.ts";
import { generateTitle } from "./title.ts";

/** 注册首个用户 turn 开始后的后台 session 自动命名 */
export default function sessionRenameExtension(pi: ExtensionAPI): void {
  let warningMessage: ((message: string) => void) | undefined;

  const controller = createSessionRenameController({
    getSessionName: () => pi.getSessionName(),
    setSessionName: (name) => pi.setSessionName(name),
    warn: (message) => warningMessage?.(message),
    generateTitle: async (model, modelRegistry, candidate, signal) => {
      return generateTitle(model, candidate.prompt, signal, (requestModel, context, options) =>
        modelRegistry.complete(requestModel, context, options),
      );
    },
  });

  pi.on("session_start", () => controller.onSessionStart());
  pi.on("input", (event) => controller.onInput(event));
  pi.on("before_agent_start", (event, ctx) => {
    warningMessage = (message) => ctx.ui.notify(message, "warning");
    controller.onBeforeAgentStart(event.prompt, ctx.model, ctx.modelRegistry);
  });
  pi.on("turn_end", (event) => {
    if (event.message.role !== "assistant") return;
    controller.onTurnEnd(event.message);
  });
  pi.on("agent_settled", () => controller.onAgentSettled());
  pi.on("session_shutdown", () => {
    controller.onSessionShutdown();
  });
}

export * from "./controller.ts";
export * from "./title.ts";

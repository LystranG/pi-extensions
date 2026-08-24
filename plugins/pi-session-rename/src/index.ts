import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSessionRenameController } from "./controller.ts";
import { generateTitle } from "./title.ts";

/** 注册首个普通用户 turn 完成后的后台 session 自动命名 */
export default function sessionRenameExtension(pi: ExtensionAPI): void {
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
  let warningMessage: ((message: string) => void) | undefined;

  pi.on("session_start", () => controller.onSessionStart());
  pi.on("input", (event) => controller.onInput(event));
  pi.on("turn_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    warningMessage = (message) => ctx.ui.notify(message, "warning");
    controller.onTurnEnd(ctx.model, ctx.modelRegistry, event.message);
  });
  pi.on("agent_settled", () => controller.onAgentSettled());
  pi.on("session_shutdown", () => {
    controller.onSessionShutdown();
  });
}

export * from "./controller.ts";
export * from "./title.ts";

// 将 Serena hook 控制器接入 Pi 的公开生命周期事件

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSerenaHookExecutor, runSerenaCommand } from "./command.ts";
import { SerenaHooksController } from "./controller.ts";
import { parseSerenaHookOutput } from "./output.ts";
import type { SerenaHookWarning } from "./types.ts";

const COMMAND = "serena-hooks";

function warningFor(ctx: ExtensionContext) {
  return (action: Parameters<SerenaHookWarning>[0], detail: string) => {
    if (ctx.hasUI) ctx.ui.notify(`${COMMAND} ${action} 失败：${detail}`, "warning");
  };
}

export default function serenaHooksExtension(pi: ExtensionAPI): void {
  const controller = new SerenaHooksController(createSerenaHookExecutor(runSerenaCommand));

  pi.on("session_start", async (_event, ctx) => {
    const result = await controller.sessionStart(ctx.sessionManager.getSessionId(), warningFor(ctx));
    const output = parseSerenaHookOutput(result?.stdout);
    if (output?.additionalContext) {
      pi.sendMessage(
        {
          customType: "serena-hooks",
          content: output.additionalContext,
          display: true,
        },
        { deliverAs: "nextTurn" },
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const result = await controller.beforeTool(
      event.toolName,
      event.input,
      ctx.sessionManager.getSessionId(),
      warningFor(ctx),
    );
    const output = parseSerenaHookOutput(result?.stdout);
    if (output?.decision === "deny") {
      return { block: true, reason: output.reason ?? "Serena hook denied this tool call" };
    }
    return undefined;
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await controller.sessionShutdown(event.reason, ctx.sessionManager.getSessionId(), warningFor(ctx));
  });
}

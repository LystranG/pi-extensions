// 将 Serena hook 控制器接入 Pi 的公开生命周期事件

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSerenaHookExecutor, runSerenaCommand } from "./command.ts";
import { SerenaHooksController } from "./controller.ts";
import { parseSerenaHookOutput } from "./output.ts";
import type { SerenaHookWarning } from "./types.ts";

const COMMAND = "serena-hooks";

function warningFor(ctx: ExtensionContext) {
  return (action: Parameters<SerenaHookWarning>[0], detail: string) => {
    if (ctx.hasUI) ctx.ui.notify(`${COMMAND} ${action} failed: ${detail}`, "warning");
  };
}

// 判断当前 session leaf 是否就是分支中的首条用户消息
function isAtFirstUserMessage(ctx: ExtensionContext): boolean {
  const firstUserMessage = ctx.sessionManager
    .getBranch()
    .find((entry) => entry.type === "message" && entry.message.role === "user");
  return firstUserMessage?.id === ctx.sessionManager.getLeafId();
}

export default function serenaHooksExtension(pi: ExtensionAPI): void {
  const controller = new SerenaHooksController(createSerenaHookExecutor(runSerenaCommand));

  const runActivate = async (result: Awaited<ReturnType<SerenaHooksController["sessionStart"]>>) => {
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
  };

  pi.on("session_start", async (event, ctx) => {
    const result = await controller.sessionStart(ctx.sessionManager.getSessionId(), warningFor(ctx), {
      resumeAtFirstMessage: event.reason === "resume" && isAtFirstUserMessage(ctx),
    });
    await runActivate(result);
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "user") return;
    const result = await controller.resumeFirstMessage(ctx.sessionManager.getSessionId(), warningFor(ctx));
    await runActivate(result);
  });

  pi.on("session_tree", (event) => {
    controller.sessionTree(event.newLeafId);
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

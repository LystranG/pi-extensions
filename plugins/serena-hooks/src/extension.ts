// 将 Serena hook 控制器接入 Pi 的公开生命周期事件

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { adaptActivateContext } from "./activate-context.ts";
import { createSerenaHookExecutor, runSerenaCommand } from "./command.ts";
import { SerenaHooksController } from "./controller.ts";
import { formatDenyReason, parseSerenaHookOutput } from "./output.ts";
import type { SerenaHookExecutor, SerenaHookResult, SerenaHookWarning } from "./types.ts";

const COMMAND = "serena-hooks";

// 生成会话内共用的失败告警回调
function warningFor(ctx: ExtensionContext) {
  return (action: Parameters<SerenaHookWarning>[0], detail: string) => {
    if (ctx.hasUI) ctx.ui.notify(`${COMMAND} ${action} failed: ${detail}`, "warning");
  };
}

// 判断导航后的分支是否已回退到首条用户消息之前：此时分支中不再包含任何用户消息
function isBeforeFirstUserMessage(ctx: ExtensionContext): boolean {
  return !ctx.sessionManager.getBranch().some((entry) => entry.type === "message" && entry.message.role === "user");
}

/**
 * 用指定的 hook 执行器构建 Pi 扩展入口
 *
 * 执行器作为参数注入，使装配层可以在不启动真实 serena-hooks 进程的情况下被测试
 */
export function createSerenaHooksExtension(execute: SerenaHookExecutor) {
  return (pi: ExtensionAPI): void => {
    const controller = new SerenaHooksController(execute);

    // activate 返回的 additionalContext 先修正失效指令，再排队到下一条用户消息，与用户输入在同一轮注入
    const runActivate = async (result: SerenaHookResult | undefined) => {
      const output = parseSerenaHookOutput(result?.stdout);
      if (!output?.additionalContext) return;
      pi.sendMessage(
        { customType: COMMAND, content: adaptActivateContext(output.additionalContext), display: true },
        { deliverAs: "nextTurn" },
      );
    };

    pi.on("session_start", async (_event, ctx) => {
      const result = await controller.sessionStart(ctx.sessionManager.getSessionId(), warningFor(ctx));
      await runActivate(result);
    });

    // 会话树回退到首条用户消息之前时，分支中原本注入的 Serena 上下文已被截断，需要重新注入
    pi.on("session_tree", async (event, ctx) => {
      // oldLeafId 与 newLeafId 相同说明分支没有真正变化（例如重复导航到同一位置），无需重复注入
      const rewound = event.oldLeafId !== event.newLeafId && isBeforeFirstUserMessage(ctx);
      const result = await controller.rewindActivate(ctx.sessionManager.getSessionId(), rewound, warningFor(ctx));
      await runActivate(result);
    });

    // 用户消息发出后，之前排队的回退激活会被该轮消费，允许之后的回退再次注入
    pi.on("message_start", (event) => {
      if (event.message.role !== "user") return;
      controller.completeRewindActivation();
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
        // 拦截原因会成为模型看到的工具结果，因此必须同时带上 Serena 的 additionalContext 提示
        return { block: true, reason: formatDenyReason(output) };
      }
      return undefined;
    });

    pi.on("session_shutdown", async (event, ctx) => {
      await controller.sessionShutdown(event.reason, ctx.sessionManager.getSessionId(), warningFor(ctx));
    });
  };
}

export default createSerenaHooksExtension(createSerenaHookExecutor(runSerenaCommand));

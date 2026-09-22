import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { ensureGuardConfig, loadGuardConfig } from "./config.ts";
import { createDcgChecker } from "./dcg.ts";
import { createNotifier } from "./notify.ts";
import { confirmStdinInput, decideCommand, summarizeCommand } from "./policy.ts";
import { extractToolRequest } from "./tools.ts";
import type { GuardConfig, GuardContext } from "./types.ts";

export * from "./config.ts";
export * from "./dcg.ts";
export * from "./notify.ts";
export * from "./policy.ts";
export { decideCommand as decideToolCall } from "./policy.ts";
export * from "./rules.ts";
export * from "./tools.ts";
export * from "./types.ts";

/** 注册 Pi Guard 的工具调用保护 */
export default function piGuardExtension(pi: ExtensionAPI): void {
  let config: GuardConfig;
  try {
    ensureGuardConfig();
    config = loadGuardConfig();
  } catch (error) {
    pi.on("tool_call", async (event, ctx) => {
      if (!isToolCallEventType("bash", event)) return undefined;
      ctx.ui.notify(`Pi Guard configuration error: ${error instanceof Error ? error.message : String(error)}`, "error");
      return { block: true, reason: "Pi Guard configuration is invalid; command execution was blocked" };
    });
    return;
  }
  const checker = createDcgChecker(config);
  // 通知器在插件加载时创建一次，节流状态因此在整个会话内共享
  const notifier = createNotifier({ config: config.notify });
  pi.on("tool_call", async (event, ctx) => {
    const request = extractToolRequest(event.toolName, event.input);
    if (request.kind === "ignore") return undefined;
    const guardContext: GuardContext = { hasUI: ctx.hasUI, mode: ctx.mode, ui: ctx.ui, notifier };
    const decision =
      request.kind === "command"
        ? await decideCommand(request.command, config, checker, guardContext)
        : await confirmStdinInput(request.input, config, guardContext);
    if (decision.deny) {
      ctx.ui.notify(
        `Blocked ${request.kind === "stdin" ? "PTY input" : "command"}: ${summarizeCommand(
          request.kind === "stdin" ? request.input : request.command,
        )}\n${decision.reason}`,
        "warning",
      );
    }
    return decision.deny ? { block: true, reason: decision.reason } : undefined;
  });
}

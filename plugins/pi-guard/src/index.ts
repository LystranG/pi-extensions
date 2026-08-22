import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { loadGuardConfig } from "./config.ts";
import { createDcgChecker } from "./dcg.ts";
import { confirmStdinInput, decideCommand, summarizeCommand } from "./policy.ts";
import { extractToolRequest } from "./tools.ts";
import type { GuardConfig } from "./types.ts";

export * from "./config.ts";
export * from "./dcg.ts";
export * from "./policy.ts";
export { decideCommand as decideToolCall } from "./policy.ts";
export * from "./rules.ts";
export * from "./tools.ts";
export * from "./types.ts";

/** 注册 Pi Guard 的工具调用保护 */
export default function piGuardExtension(pi: ExtensionAPI): void {
  let config: GuardConfig;
  try {
    config = loadGuardConfig();
  } catch (error) {
    pi.on("tool_call", async (event, ctx) => {
      if (!isToolCallEventType("bash", event)) return undefined;
      ctx.ui.notify(`Pi Guard 配置错误：${error instanceof Error ? error.message : String(error)}`, "error");
      return { block: true, reason: "Pi Guard 配置无效，已阻止命令执行" };
    });
    return;
  }
  const checker = createDcgChecker(config);
  pi.on("tool_call", async (event, ctx) => {
    const request = extractToolRequest(event.toolName, event.input);
    if (request.kind === "ignore") return undefined;
    const decision =
      request.kind === "command"
        ? await decideCommand(request.command, config, checker, ctx)
        : await confirmStdinInput(request.input, config, ctx);
    if (decision.deny) {
      ctx.ui.notify(
        `已阻止 ${request.kind === "stdin" ? "PTY 输入" : "命令"}：${summarizeCommand(
          request.kind === "stdin" ? request.input : request.command,
        )}\n${decision.reason}`,
        "warning",
      );
    }
    return decision.deny ? { block: true, reason: decision.reason } : undefined;
  });
}

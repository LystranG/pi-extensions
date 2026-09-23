import { buildConfirmNotifyRequest } from "./notify.ts";
import { findMatchingRule } from "./rules.ts";
import type { CommandChecker, GuardConfig, GuardContext, GuardDecision, GuardNotifyKind } from "./types.ts";

/** 截断命令，避免确认内容无限增长 */
export function summarizeCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

/** 根据 dcg 判定和覆盖规则决定是否阻止命令 */
export async function decideCommand(
  command: string,
  config: GuardConfig,
  checker: CommandChecker,
  ctx: GuardContext,
): Promise<GuardDecision> {
  const rule = findMatchingRule(command, config.rules);
  if (rule?.mode === "deny") {
    return { deny: true, reason: "Matched a Pi Guard denial rule", rule };
  }
  const decision = await checker(command);
  if (!decision.deny) {
    return rule?.mode === "confirm" ? confirmCommand(command, decision.reason, rule, config, ctx) : decision;
  }
  if (!rule && config.defaultMode === "deny") return decision;
  return confirmCommand(command, decision.reason, rule, config, ctx);
}

/**
 * 在弹出确认框前发送系统通知
 * 只负责交互式 TUI 这一层门禁，是否启用通知由通知器自己判断
 * 通知失败绝不能冒泡，否则 tool_call 会按 fail-safe 直接阻断工具
 */
function notifyConfirm(ctx: GuardContext, config: GuardConfig, kind: GuardNotifyKind, text: string): void {
  if (ctx.mode !== "tui") return;
  try {
    const detail = config.notify.includeCommand ? summarizeCommand(text) : undefined;
    ctx.notifier?.notify(buildConfirmNotifyRequest(kind, detail));
  } catch {
    // 通知是尽力而为的副作用，失败时继续弹确认框
  }
}

/** 在可用界面中确认危险命令 */
async function confirmCommand(
  command: string,
  reason: string,
  rule: GuardDecision["rule"],
  config: GuardConfig,
  ctx: GuardContext,
): Promise<GuardDecision> {
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: `${reason} (no confirmation UI is available)`, rule };
  }
  const ruleText = rule ? `\nMatching rule: ${rule.command} (${rule.match ?? "exact"})` : "";
  notifyConfirm(ctx, config, "command", command);
  const confirmed = await ctx.ui.confirm(
    "Confirm dangerous command",
    `${summarizeCommand(command)}\n\n${reason}${ruleText}`,
  );
  return confirmed
    ? { deny: false, reason: "" }
    : { deny: true, reason: "User did not confirm the dangerous command", rule };
}

/** write_stdin 的非空输入必须单独确认，不能假设是完整 shell 命令 */
export async function confirmStdinInput(input: string, config: GuardConfig, ctx: GuardContext): Promise<GuardDecision> {
  if (!input) return { deny: false, reason: "" };
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: "Non-empty write_stdin input was blocked because no confirmation UI is available" };
  }
  notifyConfirm(ctx, config, "stdin", input);
  const confirmed = await ctx.ui.confirm("Confirm PTY input", summarizeCommand(input));
  return confirmed ? { deny: false, reason: "" } : { deny: true, reason: "User did not confirm the PTY input" };
}

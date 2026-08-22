import { findMatchingRule } from "./rules.ts";
import type { CommandChecker, GuardConfig, GuardContext, GuardDecision } from "./types.ts";

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
    return { deny: true, reason: "命中 Pi Guard 拒绝规则", rule };
  }
  const decision = await checker(command);
  if (!rule) return decision;
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: `${decision.reason}（当前无可用确认界面）`, rule };
  }
  const ruleText = `\n匹配规则：${rule.command}（${rule.match ?? "exact"}）`;
  const confirmed = await ctx.ui.confirm(
    "确认危险命令",
    `${summarizeCommand(command)}\n\n${decision.reason}${ruleText}`,
  );
  return confirmed ? { deny: false, reason: "" } : { deny: true, reason: "用户未确认危险命令", rule };
}

/** write_stdin 的非空输入必须单独确认，不能假设是完整 shell 命令 */
export async function confirmStdinInput(input: string, config: GuardConfig, ctx: GuardContext): Promise<GuardDecision> {
  if (!input) return { deny: false, reason: "" };
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: "write_stdin 非空输入在无确认界面时已阻止" };
  }
  const confirmed = await ctx.ui.confirm("确认 PTY 输入", summarizeCommand(input));
  return confirmed ? { deny: false, reason: "" } : { deny: true, reason: "用户未确认 PTY 输入" };
}

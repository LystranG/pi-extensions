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
    return { deny: true, reason: "Matched a Pi Guard denial rule", rule };
  }
  const decision = await checker(command);
  if (!decision.deny) {
    return rule?.mode === "confirm" ? confirmCommand(command, decision.reason, rule, config.headless, ctx) : decision;
  }
  if (!rule && config.defaultMode === "deny") return decision;
  return confirmCommand(command, decision.reason, rule, config.headless, ctx);
}

/** 在可用界面中确认危险命令 */
async function confirmCommand(
  command: string,
  reason: string,
  rule: GuardDecision["rule"],
  headless: GuardConfig["headless"],
  ctx: GuardContext,
): Promise<GuardDecision> {
  if (!ctx.hasUI) {
    return headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: `${reason} (no confirmation UI is available)`, rule };
  }
  const ruleText = rule ? `\nMatching rule: ${rule.command} (${rule.match ?? "exact"})` : "";
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
  const confirmed = await ctx.ui.confirm("Confirm PTY input", summarizeCommand(input));
  return confirmed ? { deny: false, reason: "" } : { deny: true, reason: "User did not confirm the PTY input" };
}

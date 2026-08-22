import type { GuardRule } from "./types.ts";

/** 转义通配符规则中的普通字符 */
function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** 查找第一条匹配当前危险命令的规则 */
export function findMatchingRule(command: string, rules: GuardRule[]): GuardRule | undefined {
  return rules.find((rule) => {
    if (rule.match === "prefix") return command === rule.command || command.startsWith(`${rule.command} `);
    if (rule.match === "wildcard" || (rule.match === undefined && rule.command.includes("*"))) {
      const pattern = `^${rule.command.split("*").map(escapeRegex).join(".*")}$`;
      return new RegExp(pattern).test(command);
    }
    if (rule.match === "regex") return new RegExp(rule.command).test(command);
    return command === rule.command;
  });
}

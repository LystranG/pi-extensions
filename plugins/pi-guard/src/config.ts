import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GuardConfig, GuardRule } from "./types.ts";

const DEFAULT_CONFIG: Omit<GuardConfig, "rules"> = { binary: "dcg", headless: "deny", timeoutMs: 2_000 };

/** 校验数组形式的规则 */
function parseRuleList(rawRules: unknown[]): GuardRule[] {
  return rawRules.map((rawRule, index): GuardRule => {
    if (typeof rawRule !== "object" || rawRule === null) throw new Error(`Pi Guard rules[${index}] must be an object`);
    const rule = rawRule as Record<string, unknown>;
    const command = rule.command;
    const mode = rule.mode;
    const match = rule.match ?? (typeof command === "string" && command.includes("*") ? "wildcard" : "exact");
    if (typeof command !== "string" || !command.trim()) throw new Error(`Pi Guard rules[${index}].command is invalid`);
    if (mode !== "deny" && mode !== "confirm") throw new Error(`Pi Guard rules[${index}].mode is invalid`);
    if (match !== "exact" && match !== "prefix" && match !== "wildcard" && match !== "regex") {
      throw new Error(`Pi Guard rules[${index}].match is invalid`);
    }
    if (match === "regex") {
      try {
        new RegExp(command);
      } catch {
        throw new Error(`Pi Guard rules[${index}].command is not a valid regular expression`);
      }
    }
    return { command, mode, match };
  });
}

/** 校验 permission.bash 映射 */
function parsePermissionMap(value: Record<string, unknown>): GuardRule[] {
  return Object.entries(value).map(([command, mode]): GuardRule => {
    if (command === "*") throw new Error("Pi Guard does not allow a global bash * override rule");
    if (mode !== "ask" && mode !== "deny") {
      throw new Error(`Pi Guard permission.bash[${command}] must be ask or deny`);
    }
    return { command, mode: mode === "ask" ? "confirm" : "deny", match: command.includes("*") ? "wildcard" : "exact" };
  });
}

/** 校验 JSON 配置 */
function parseConfig(value: unknown): Pick<GuardConfig, "headless" | "rules"> {
  if (typeof value !== "object" || value === null) throw new Error("Pi Guard configuration must be a JSON object");
  const record = value as Record<string, unknown>;
  const headless = record.headless ?? DEFAULT_CONFIG.headless;
  if (headless !== "deny" && headless !== "allow") throw new Error("Pi Guard headless must be deny or allow");
  const permission = record.permission;
  const bash =
    typeof permission === "object" && permission !== null ? (permission as Record<string, unknown>).bash : undefined;
  const rawRules = record.rules;
  const rules = Array.isArray(rawRules)
    ? parseRuleList(rawRules)
    : typeof bash === "object" && bash !== null
      ? parsePermissionMap(bash as Record<string, unknown>)
      : rawRules === undefined
        ? []
        : (() => {
            throw new Error("Pi Guard rules or permission.bash must be an object or array");
          })();
  return { headless, rules };
}

/** 从环境变量和项目或用户配置文件读取插件配置 */
export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): GuardConfig {
  const configPath =
    env.PI_GUARD_CONFIG?.trim() ||
    [join(cwd, ".pi", "guard.json"), join(homedir(), ".pi", "agent", "guard.json")].find(existsSync);
  let fileConfig: Pick<GuardConfig, "headless" | "rules"> = { headless: DEFAULT_CONFIG.headless, rules: [] };
  if (configPath) {
    try {
      fileConfig = parseConfig(JSON.parse(readFileSync(configPath, "utf8")));
    } catch (error) {
      throw new Error(
        `Unable to load Pi Guard configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const headless = env.DCG_PI_HEADLESS ?? fileConfig.headless;
  const timeoutMs = Number(env.DCG_PI_TIMEOUT_MS ?? DEFAULT_CONFIG.timeoutMs);
  if (headless !== "deny" && headless !== "allow") throw new Error(`DCG_PI_HEADLESS is invalid: ${headless}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("DCG_PI_TIMEOUT_MS must be an integer between 1 and 60000");
  }
  return { binary: env.DCG_BIN?.trim() || DEFAULT_CONFIG.binary, headless, timeoutMs, rules: fileConfig.rules };
}

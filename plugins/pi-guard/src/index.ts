import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, isToolCallEventType } from "@earendil-works/pi-coding-agent";

/** 危险命令的处理模式 */
export type GuardMode = "deny" | "confirm";

/** 无界面运行时的处理模式 */
export type HeadlessMode = "deny" | "allow";

/** 具体命令规则的匹配方式 */
export type RuleMatch = "exact" | "prefix" | "wildcard" | "regex";

/** 针对具体危险命令的覆盖规则 */
export interface GuardRule {
  /** 要匹配的命令文本或正则表达式 */
  command: string;
  /** 规则命中后的处理方式 */
  mode: GuardMode;
  /** 默认按完整命令匹配 */
  match?: RuleMatch;
}

/** 插件运行配置 */
export interface GuardConfig {
  /** dcg 可执行文件路径 */
  binary: string;
  /** 没有可用 UI 时的处理方式 */
  headless: HeadlessMode;
  /** 单次 dcg 判定的超时时间 */
  timeoutMs: number;
  /** 针对具体危险命令的处理规则 */
  rules: GuardRule[];
}

/** dcg 判定结果 */
export interface GuardDecision {
  /** 是否判定为危险或无法安全判定 */
  deny: boolean;
  /** 展示给 Pi 或用户的原因 */
  reason: string;
  /** 命中的配置规则 */
  rule?: GuardRule | undefined;
}

/** 可替换的 dcg 判定器 */
export type CommandChecker = (command: string) => Promise<GuardDecision>;

/** 策略判断实际需要的最小 Pi UI 上下文 */
export type GuardContext = Pick<ExtensionContext, "hasUI"> & {
  ui: Pick<ExtensionContext["ui"], "confirm" | "notify">;
};

const DEFAULT_CONFIG: Omit<GuardConfig, "rules"> = {
  binary: "dcg",
  headless: "deny",
  timeoutMs: 2_000,
};

/** 校验 JSON 配置 */
function parseConfig(value: unknown): Pick<GuardConfig, "headless" | "rules"> {
  if (typeof value !== "object" || value === null) throw new Error("Pi Guard 配置必须是 JSON 对象");
  const record = value as Record<string, unknown>;
  const headless = record.headless ?? DEFAULT_CONFIG.headless;
  if (headless !== "deny" && headless !== "allow") {
    throw new Error("Pi Guard 的 headless 必须是 deny 或 allow");
  }
  const permission = record.permission;
  const bashPermissions =
    typeof permission === "object" && permission !== null ? (permission as Record<string, unknown>).bash : undefined;
  const rawRules =
    record.rules ?? (typeof bashPermissions === "object" && bashPermissions !== null ? bashPermissions : []);
  const rules = Array.isArray(rawRules)
    ? rawRules.map((rawRule, index): GuardRule => {
        if (typeof rawRule !== "object" || rawRule === null) throw new Error(`Pi Guard rules[${index}] 必须是对象`);
        const rule = rawRule as Record<string, unknown>;
        const command = rule.command;
        const mode = rule.mode;
        const match = rule.match ?? (typeof command === "string" && command.includes("*") ? "wildcard" : "exact");
        if (typeof command !== "string" || !command.trim()) throw new Error(`Pi Guard rules[${index}].command 无效`);
        if (mode !== "deny" && mode !== "confirm") throw new Error(`Pi Guard rules[${index}].mode 无效`);
        if (match !== "exact" && match !== "prefix" && match !== "wildcard" && match !== "regex") {
          throw new Error(`Pi Guard rules[${index}].match 无效`);
        }
        if (match === "regex") {
          try {
            new RegExp(command);
          } catch {
            throw new Error(`Pi Guard rules[${index}].command 不是有效正则表达式`);
          }
        }
        return { command, mode, match };
      })
    : typeof rawRules === "object" && rawRules !== null
      ? Object.entries(rawRules).map(([command, mode]): GuardRule => {
          if (command === "*") throw new Error("Pi Guard 不允许使用 bash 的全局 * 覆盖规则");
          if (mode !== "ask" && mode !== "deny")
            throw new Error(`Pi Guard permission.bash[${command}] 必须是 ask 或 deny`);
          return {
            command,
            mode: mode === "ask" ? "confirm" : "deny",
            match: command.includes("*") ? "wildcard" : "exact",
          };
        })
      : (() => {
          throw new Error("Pi Guard 的 rules 或 permission.bash 必须是对象或数组");
        })();
  return { headless, rules };
}

/** 从环境变量和项目或用户配置文件读取插件配置 */
export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): GuardConfig {
  const configPath =
    env.PI_GUARD_CONFIG?.trim() ||
    [join(cwd, ".pi", "guard.json"), join(homedir(), ".pi", "agent", "guard.json")].find(existsSync);
  let fileConfig: Pick<GuardConfig, "headless" | "rules"> = {
    headless: DEFAULT_CONFIG.headless,
    rules: [],
  };
  if (configPath) {
    try {
      fileConfig = parseConfig(JSON.parse(readFileSync(configPath, "utf8")));
    } catch (error) {
      throw new Error(
        `无法加载 Pi Guard 配置 ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const headless = env.DCG_PI_HEADLESS ?? fileConfig.headless;
  const timeoutMs = Number(env.DCG_PI_TIMEOUT_MS ?? DEFAULT_CONFIG.timeoutMs);
  if (headless !== "deny" && headless !== "allow") {
    throw new Error(`DCG_PI_HEADLESS 必须是 deny 或 allow，实际为 ${headless}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("DCG_PI_TIMEOUT_MS 必须是 1 到 60000 之间的整数");
  }
  return {
    binary: env.DCG_BIN?.trim() || DEFAULT_CONFIG.binary,
    headless,
    timeoutMs,
    rules: fileConfig.rules,
  };
}

/** 截断命令，避免通知内容无限增长 */
function summarizeCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
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

/** 转义通配符规则中的普通字符 */
function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** 解析 dcg robot JSON 中可供用户理解的拒绝原因 */
function parseReason(stdout: string): string {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      const ruleId = typeof record.rule_id === "string" ? record.rule_id : undefined;
      if (reason && ruleId) return `${reason} [${ruleId}]`;
      if (reason) return reason;
      if (ruleId) return `dcg 拒绝了此命令 [${ruleId}]`;
    }
  } catch {
    // dcg 的拒绝结果损坏时使用固定原因
  }
  return "dcg 判定此命令具有破坏性";
}

/** 通过 dcg robot API 判定一个命令 */
export function createDcgChecker(options: Pick<GuardConfig, "binary" | "timeoutMs"> = DEFAULT_CONFIG): CommandChecker {
  return (command) =>
    new Promise((resolve) => {
      let settled = false;
      let stdout = "";
      const child = spawn(options.binary, ["--robot", "test", command], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const finish = (decision: GuardDecision): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(decision);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ deny: true, reason: "dcg 判定超时，已阻止命令执行" });
      }, options.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < 16_384) stdout += chunk.toString();
      });
      child.on("error", () => {
        finish({ deny: true, reason: "无法运行 dcg，已阻止命令执行" });
      });
      child.on("close", (code) => {
        if (code === 0) finish({ deny: false, reason: "" });
        else if (code === 1) finish({ deny: true, reason: parseReason(stdout) });
        else finish({ deny: true, reason: `dcg 返回错误（退出码 ${code ?? "未知"}），已阻止命令执行` });
      });
    });
}

/** 根据判定结果和规则配置决定是否阻止工具调用 */
export async function decideToolCall(
  command: string,
  config: GuardConfig,
  checker: CommandChecker,
  ctx: GuardContext,
): Promise<GuardDecision> {
  const decision = await checker(command);
  if (!decision.deny) return decision;
  const rule = findMatchingRule(command, config.rules);
  const mode = rule?.mode ?? "deny";
  const guardedDecision = rule ? { ...decision, rule } : decision;
  if (mode === "deny") return guardedDecision;
  if (!ctx.hasUI) {
    return config.headless === "allow"
      ? { deny: false, reason: "" }
      : { deny: true, reason: `${decision.reason}（当前无可用确认界面）`, rule };
  }
  const ruleText = rule ? `\n匹配规则：${rule.command}（${rule.match ?? "exact"}）` : "";
  const confirmed = await ctx.ui.confirm(
    "确认危险命令",
    `${summarizeCommand(command)}\n\n${decision.reason}${ruleText}`,
  );
  return confirmed ? { deny: false, reason: "" } : { deny: true, reason: "用户未确认危险命令", rule };
}

/** 注册 dcg 保护 Pi 的 bash 工具调用 */
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
    if (!isToolCallEventType("bash", event)) return undefined;
    const command = event.input.command.trim();
    if (!command) return undefined;
    const decision = await decideToolCall(command, config, checker, ctx);
    if (decision.deny) {
      const ruleText = decision.rule ? `\n匹配规则：${decision.rule.command}` : "";
      ctx.ui.notify(`已阻止命令：${summarizeCommand(command)}\n${decision.reason}${ruleText}`, "warning");
    }
    return decision.deny ? { block: true, reason: decision.reason } : undefined;
  });
}

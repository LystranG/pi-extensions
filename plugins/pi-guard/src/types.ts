import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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

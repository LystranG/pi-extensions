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
  /** 未命中具体规则时的危险命令处理模式 */
  defaultMode: GuardMode;
  /** 没有可用 UI 时的处理方式 */
  headless: HeadlessMode;
  /** 单次 dcg 判定的超时时间 */
  timeoutMs: number;
  /** 针对具体危险命令的处理规则 */
  rules: GuardRule[];
  /** 确认框出现时的系统通知配置 */
  notify: GuardNotifyConfig;
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
/** 确认框的来源，用于决定通知正文 */
export type GuardNotifyKind = "command" | "stdin";
/** 一次系统通知的标题与正文 */
export interface NotifyRequest {
  /** 通知标题 */
  title: string;
  /** 通知正文 */
  body: string;
}
/** 一条系统通知候选命令，参数以数组传递，避免经过 shell 解释 */
export interface NotifyCommand {
  /** 可执行文件名称或绝对路径 */
  bin: string;
  /** 传给可执行文件的参数数组 */
  args: string[];
}
/** 系统通知配置 */
export interface GuardNotifyConfig {
  /** 是否在确认框出现时发送系统通知 */
  enabled: boolean;
  /** 是否把截断后的命令文本追加到通知正文 */
  includeCommand: boolean;
  /** 两次通知之间的最小间隔，用于抑制连续确认 */
  minIntervalMs: number;
  /** 每分钟最多发送的通知数量 */
  maxPerMinute: number;
  /** 是否写终端响铃：多路复用器里它是投递通道，其它情况下是系统通知全部失败后的兜底 */
  bell: boolean;
}
/** 可替换的系统通知器，实现方必须保证 notify 永不抛出异常 */
export interface GuardNotifier {
  /** 发送一次确认框通知，不阻塞调用方 */
  notify(request: NotifyRequest): void;
}
/** 策略判断实际需要的最小 Pi UI 上下文 */
export type GuardContext = Pick<ExtensionContext, "hasUI" | "mode"> & {
  ui: Pick<ExtensionContext["ui"], "confirm" | "notify">;
  /** 可选的系统通知器，缺省表示不发送系统通知 */
  notifier?: GuardNotifier;
};

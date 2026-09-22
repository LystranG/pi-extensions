import { spawn } from "node:child_process";
import type { GuardNotifier, GuardNotifyConfig, GuardNotifyKind, NotifyCommand, NotifyRequest } from "./types.ts";

/** 通知标题固定使用插件名，便于用户在通知中心识别来源 */
const NOTIFY_TITLE = "Pi Guard";
/** terminal-notifier 会把以这些字符开头的值当作 plist 或选项语法解析 */
const TERMINAL_NOTIFIER_TRIGGERS = new Set(["[", "(", "{", '"']);
/** macOS 无法弹出通知中心横幅时使用的声音文件 */
const MAC_FALLBACK_SOUND = "/System/Library/Sounds/Glass.aiff";
/** 单条通知命令的超时时间，超过即强杀并继续降级 */
const NOTIFY_TIMEOUT_MS = 5_000;
/** 每分钟通知上限的统计窗口 */
const THROTTLE_WINDOW_MS = 60_000;

/** 构造确认框对应的通知内容，缺省不包含命令文本 */
export function buildConfirmNotifyRequest(kind: GuardNotifyKind, detail?: string): NotifyRequest {
  const body = kind === "command" ? "Dangerous command needs approval" : "PTY input needs approval";
  return { title: NOTIFY_TITLE, body: detail ? `${body}\n${detail}` : body };
}

/**
 * 转义会触发 terminal-notifier 解析异常的首字符
 * 当前通知标题与正文都以固定英文短语开头，因此这条转义在生产路径上不会命中
 * 一旦正文改为可由用户或模型决定的内容，它就是必需的，所以保留并由单测锁定
 */
export function escapeTerminalNotifierValue(value: string): string {
  return TERMINAL_NOTIFIER_TRIGGERS.has(value.slice(0, 1)) ? `\\${value}` : value;
}

/** 把任意文本编码成 gdbus 需要的 GVariant 字符串字面量 */
export function toGVariantString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

/**
 * 按平台给出系统通知的降级链
 * 调用方在前一项失败时继续尝试后一项，全部失败则退化为终端响铃
 */
export function planNotifyCommands(platform: NodeJS.Platform, request: NotifyRequest): NotifyCommand[] {
  if (platform === "darwin") return planMacNotifyCommands(request);
  if (platform === "linux") return planLinuxNotifyCommands(request);
  return [];
}

/** macOS 降级链：terminal-notifier 需要额外安装，osascript 与 afplay 随系统提供 */
function planMacNotifyCommands({ title, body }: NotifyRequest): NotifyCommand[] {
  return [
    {
      bin: "terminal-notifier",
      args: [
        "-title",
        escapeTerminalNotifierValue(title),
        "-message",
        escapeTerminalNotifierValue(body),
        "-group",
        "pi-guard",
      ],
    },
    {
      bin: "osascript",
      // 脚本正文是常量，通知文本只作为 argv 传入，因此不存在 AppleScript 插值注入面
      // 正文始终以固定的英文提示开头，不会出现被 osascript 误当成选项的前导短横线
      args: [
        "-e",
        "on run argv",
        "-e",
        "display notification (item 1 of argv) with title (item 2 of argv)",
        "-e",
        "end run",
        body,
        title,
      ],
    },
    { bin: "afplay", args: [MAC_FALLBACK_SOUND] },
  ];
}

/** Linux 降级链：notify-send 来自 libnotify，gdbus 直连会话总线 */
function planLinuxNotifyCommands({ title, body }: NotifyRequest): NotifyCommand[] {
  return [
    {
      bin: "notify-send",
      args: ["-a", "pi-guard", "-u", "critical", "-i", "dialog-warning", "--", title, body],
    },
    {
      bin: "gdbus",
      args: [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.Notifications",
        "--object-path",
        "/org/freedesktop/Notifications",
        "--method",
        "org.freedesktop.Notifications.Notify",
        toGVariantString("pi-guard"),
        "0",
        toGVariantString(""),
        toGVariantString(title),
        toGVariantString(body),
        "[]",
        "{}",
        "-1",
      ],
    },
  ];
}

/** 单项通知命令的执行器，返回 true 表示该命令已成功送达 */
export type CommandRunner = (command: NotifyCommand) => Promise<boolean>;

/** 创建通知器所需依赖，全部可替换以便测试 */
export interface NotifierOptions {
  /** 通知配置 */
  config: GuardNotifyConfig;
  /** 目标平台，缺省取当前进程平台 */
  platform?: NodeJS.Platform;
  /** 通知命令执行器，缺省用独立进程运行 */
  runCommand?: CommandRunner;
  /** 系统通知全部失败时写终端响铃，缺省写一个 BEL 到标准输出 */
  ringBell?: () => void;
  /** 时钟，缺省取系统时间 */
  now?: () => number;
}

/** 创建系统通知器，notify 不阻塞调用方，任何失败都静默降级 */
export function createNotifier(options: NotifierOptions): GuardNotifier {
  const {
    config,
    platform = process.platform,
    runCommand = runNotifyCommand,
    ringBell = ringBellOnStdout,
    now = Date.now,
  } = options;
  const allowAttempt = createThrottle(config, now);
  return {
    notify(request) {
      if (!config.enabled || !allowAttempt()) return;
      void sendNotifyCommands(planNotifyCommands(platform, request), runCommand)
        .then((delivered) => {
          if (!delivered && config.bell) ringBell();
        })
        .catch(() => {
          // 通知与响铃都是尽力而为，既不能影响确认框，也不能变成未处理的 rejection
        });
    },
  };
}

/** 生成节流判断，命中即记录本次尝试，失败的通知同样占用配额以避免刷屏 */
function createThrottle(config: GuardNotifyConfig, now: () => number): () => boolean {
  const attempts: number[] = [];
  return () => {
    const timestamp = now();
    const windowStart = timestamp - THROTTLE_WINDOW_MS;
    while (attempts.length > 0 && (attempts[0] as number) <= windowStart) attempts.shift();
    const last = attempts.at(-1);
    if (last !== undefined && timestamp - last < config.minIntervalMs) return false;
    if (attempts.length >= config.maxPerMinute) return false;
    attempts.push(timestamp);
    return true;
  };
}

/** 依次尝试降级链中的通知命令，返回是否至少有一项成功 */
export async function sendNotifyCommands(commands: NotifyCommand[], runCommand: CommandRunner): Promise<boolean> {
  for (const command of commands) {
    try {
      if (await runCommand(command)) return true;
    } catch {
      // 单项通知失败时继续尝试下一项
    }
  }
  return false;
}

/**
 * 默认执行器：以独立进程运行一条通知命令
 * 按退出码判定成功，超时则强杀，命令缺失或失败都返回 false 让调用方继续降级
 * 子进程与超时计时器都 unref，这样通知不会拖住 Pi 的退出，同时父进程存活期间仍能收到退出码
 */
export function runNotifyCommand(command: NotifyCommand, timeoutMs = NOTIFY_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command.bin, command.args, { stdio: "ignore", detached: true, windowsHide: true });
    child.unref();
    const finish = (delivered: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(delivered);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, timeoutMs);
    timer.unref();
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/** 最后兜底：向终端写一个 BEL，单字节且不可打印，不会破坏 TUI 渲染 */
function ringBellOnStdout(): void {
  process.stdout.write("\x07");
}

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

/** 终端身份探测所需的最小环境变量视图 */
export type TerminalEnv = Record<string, string | undefined>;

/** 终端 OSC 通知的目标类型：kitty 只认 OSC 99，其余支持的终端用 OSC 777 */
export type TerminalNotifyTarget = "kitty" | "osc777";

/**
 * 判断是否运行在终端多路复用器里
 * tmux 与 screen 会丢弃裸 OSC，所以它们不能走 OSC 层；但两者都消费 BEL：
 * tmux 把它变成窗口提醒（window_bell_flag），并按 visual-bell 的设置决定是否透传给外层终端，
 * 外层终端（例如 iTerm2 的 bell 通知）收到后能弹出可点击的原生通知
 * 这里只认 TMUX / STY：走 BEL 通道意味着放弃系统通知链，所以只有确定在多路复用器里才启用；
 * TERM 里的 tmux-* / screen-* 只是「OSC 一定被丢弃」的证据，不足以证明有东西会消费这个 BEL
 */
function isMultiplexed(env: TerminalEnv): boolean {
  return Boolean(env.TMUX || env.STY);
}

/**
 * 判断终端是否必须排除在 OSC 通知之外
 * tmux 与 screen 一定在这里命中：裸 OSC 会被它们直接丢弃（不是透传），而 tmux 3.3 起覆写
 * TERM_PROGRAM 却不清楚洗 KITTY_WINDOW_ID / ITERM_SESSION_ID，只看 TERM_PROGRAM 会误判成外层终端
 * 所以这两个多路复用器只能按 TMUX / STY 本身判断，TERM 前缀判断只是额外的防线
 */
function isTerminalNotifyUnsupported(env: TerminalEnv): boolean {
  const term = env.TERM ?? "";
  return Boolean(
    isMultiplexed(env) ||
      // Windows Terminal 的 OSC 777 默认关闭，且聚焦时会被抑制
      env.WT_SESSION ||
      env.TERM_PROGRAM === "tmux" ||
      // VS Code 的 xterm.js 官方序列表里没有 OSC 9 / 99 / 777
      env.TERM_PROGRAM === "vscode" ||
      env.TERM_PROGRAM === "Apple_Terminal" ||
      term.startsWith("screen") ||
      term.includes("tmux") ||
      term.includes("alacritty") ||
      term === "dumb",
  );
}

/**
 * 探测当前终端能否渲染 OSC 通知，命中返回目标类型
 * 白名单之外一律返回 undefined，交由系统通知链兜底；宁可漏判也不误判
 */
export function detectTerminalNotifyTarget(env: TerminalEnv): TerminalNotifyTarget | undefined {
  if (isTerminalNotifyUnsupported(env)) return undefined;
  const term = env.TERM ?? "";
  if (env.KITTY_WINDOW_ID || env.TERM_PROGRAM === "kitty" || term.includes("kitty")) {
    return "kitty";
  }
  const rendersOsc777 =
    Boolean(env.GHOSTTY_RESOURCES_DIR) ||
    env.TERM_PROGRAM === "ghostty" ||
    env.TERM_PROGRAM === "WezTerm" ||
    env.TERM_PROGRAM === "iTerm.app" ||
    Boolean(env.ITERM_SESSION_ID) ||
    env.TERM_PROGRAM === "WarpTerminal" ||
    // OSC 777 出自 rxvt-unicode；裸 rxvt 也以 rxvt 开头的 TERM 不代表它支持这个扩展
    term.startsWith("rxvt-unicode");
  return rendersOsc777 ? "osc777" : undefined;
}

/** kitty 的 OSC 99 通知标识，合法字符集是 a-z A-Z 0-9 _ - + . */
const KITTY_NOTIFY_ID = "pi-guard";
/** OSC 99 的字符串终止符 */
const OSC_ST = "\x1b\\";
/** OSC 777 的字符串终止符 */
const OSC_BEL = "\x07";

/**
 * 把通知文本压成不会破坏转义序列的载荷
 * 覆盖三类字符：C0 控制字符（含 ESC 与 BEL，能提前终结序列）、DEL、C1 控制字符
 * 另外把分号换成逗号，因为 OSC 777 用分号分隔字段
 * 无论 includeCommand 是否为 true 都会执行，代码里不存在「看起来安全就跳过」的分支
 */
function sanitizeTerminalNotifyText(text: string): string {
  // \p{Cc} 即 Unicode 的 Control 类：C0（含 ESC 与 BEL）+ DEL + C1，与 kitty 的 escape code safe UTF-8 定义一致
  return text.replace(/\p{Cc}/gu, " ").replaceAll(";", ",");
}

/** 构造一条终端 OSC 通知序列，标题与正文里的控制字符会先被清理 */
export function buildTerminalNotifySequence(target: TerminalNotifyTarget, { title, body }: NotifyRequest): string {
  const safeTitle = sanitizeTerminalNotifyText(title);
  const safeBody = sanitizeTerminalNotifyText(body);
  if (target === "kitty") {
    // 第一段 d=0 表示通知尚未发完，第二段省略 d 即表示已完成
    return `\x1b]99;i=${KITTY_NOTIFY_ID}:d=0;${safeTitle}${OSC_ST}\x1b]99;i=${KITTY_NOTIFY_ID}:p=body;${safeBody}${OSC_ST}`;
  }
  return `\x1b]777;notify;${safeTitle};${safeBody}${OSC_BEL}`;
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
  /** 写终端响铃，缺省写一个 BEL 到标准输出；多路复用器里它是投递通道，其它情况下是系统通知全部失败后的兜底 */
  ringBell?: () => void;
  /** 时钟，缺省取系统时间 */
  now?: () => number;
  /** 终端身份环境变量，缺省取当前进程环境 */
  env?: TerminalEnv;
  /** 标准输出是否是可写转义序列的交互式终端，缺省按 isTTY 判断 */
  interactive?: boolean;
  /** 写入终端转义序列，缺省直接写标准输出 */
  writeSequence?: (sequence: string) => void;
}

/** 创建系统通知器，notify 不阻塞调用方，任何失败都静默降级 */
export function createNotifier(options: NotifierOptions): GuardNotifier {
  const {
    config,
    platform = process.platform,
    runCommand = runNotifyCommand,
    ringBell = ringBellOnStdout,
    now = Date.now,
    env = process.env,
    interactive = process.stdout.isTTY === true,
    writeSequence = (sequence: string) => process.stdout.write(sequence),
  } = options;
  const allowAttempt = createThrottle(config, now);
  return {
    notify(request) {
      if (!config.enabled || !allowAttempt()) return;
      if (interactive) {
        // 多路复用器里 BEL 就是投递通道：不要走 OSC 层（会被丢弃）
        // bell 关掉时不占用这条通道，继续走系统通知链，避免一个开关让安全插件彻底静默
        if (config.bell && isMultiplexed(env)) {
          ringBell();
          return;
        }
        const target = detectTerminalNotifyTarget(env);
        if (target) {
          // 终端自己就能显示通知时不再 spawn 系统通知进程，避免同一件事弹两次
          // OSC 没有失败反馈，所以白名单必须保守：宁可漏判退回系统通知，也不能误判后静默失效
          writeSequence(buildTerminalNotifySequence(target, request));
          return;
        }
      }
      void sendNotifyCommands(planNotifyCommands(platform, request), runCommand)
        .then((delivered) => {
          if (!delivered && config.bell && interactive) ringBell();
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

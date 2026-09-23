import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFY_CONFIG } from "../src/config.ts";
import {
  buildConfirmNotifyRequest,
  buildTerminalNotifySequence,
  createNotifier,
  detectTerminalNotifyTarget,
  escapeTerminalNotifierValue,
  planNotifyCommands,
  runNotifyCommand,
  toGVariantString,
} from "../src/notify.ts";

/** 通知配置直接沿用插件默认值，避免测试与 config.ts 的默认值漂移 */
const notifyConfig = DEFAULT_NOTIFY_CONFIG;
const request = { title: "Pi Guard", body: "Dangerous command needs approval" };

/** 等待通知器内部 fire-and-forget 的异步流程结束 */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("notification command planning", () => {
  test("prefers terminal-notifier on macOS and degrades to osascript then afplay", () => {
    const commands = planNotifyCommands("darwin", request);

    expect(commands.map((command) => command.bin)).toEqual(["terminal-notifier", "osascript", "afplay"]);
    expect(commands[0]?.args).toEqual([
      "-title",
      "Pi Guard",
      "-message",
      "Dangerous command needs approval",
      "-group",
      "pi-guard",
    ]);
    expect(commands[1]?.args).toEqual([
      "-e",
      "on run argv",
      "-e",
      "display notification (item 1 of argv) with title (item 2 of argv)",
      "-e",
      "end run",
      "Dangerous command needs approval",
      "Pi Guard",
    ]);
    expect(commands[2]?.args).toEqual(["/System/Library/Sounds/Glass.aiff"]);
  });

  test("passes notification text to osascript as argv instead of interpolating it", () => {
    const commands = planNotifyCommands("darwin", { title: 'Pi "Guard"', body: 'rm -rf "x" ; $(whoami)' });
    const script = commands[1]?.args ?? [];
    const argv = script.slice(script.indexOf("end run") + 1);

    expect(argv).toEqual(['rm -rf "x" ; $(whoami)', 'Pi "Guard"']);
    expect(script.filter((argument) => argument.includes("rm -rf"))).toHaveLength(1);
  });

  test("prefers notify-send on Linux and degrades to gdbus", () => {
    const commands = planNotifyCommands("linux", request);

    expect(commands.map((command) => command.bin)).toEqual(["notify-send", "gdbus"]);
    expect(commands[0]?.args).toEqual([
      "-a",
      "pi-guard",
      "-u",
      "critical",
      "-i",
      "dialog-warning",
      "--",
      "Pi Guard",
      "Dangerous command needs approval",
    ]);
    expect(commands[1]?.args).toEqual([
      "call",
      "--session",
      "--dest",
      "org.freedesktop.Notifications",
      "--object-path",
      "/org/freedesktop/Notifications",
      "--method",
      "org.freedesktop.Notifications.Notify",
      '"pi-guard"',
      "0",
      '""',
      '"Pi Guard"',
      '"Dangerous command needs approval"',
      "[]",
      "{}",
      "-1",
    ]);
  });

  test("plans no system notification command on unsupported platforms", () => {
    expect(planNotifyCommands("win32", request)).toEqual([]);
  });
});

describe("notification argument escaping", () => {
  test("escapes terminal-notifier values that look like option or plist syntax", () => {
    expect(escapeTerminalNotifierValue('"quoted')).toBe('\\"quoted');
    expect(escapeTerminalNotifierValue("[1]")).toBe("\\[1]");
    expect(escapeTerminalNotifierValue("(group)")).toBe("\\(group)");
    expect(escapeTerminalNotifierValue("{key}")).toBe("\\{key}");
    expect(escapeTerminalNotifierValue("rm -rf /tmp/build")).toBe("rm -rf /tmp/build");
  });

  test("quotes gdbus text as a GVariant string literal", () => {
    expect(toGVariantString('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(toGVariantString("line1\nline2")).toBe('"line1\\nline2"');
    expect(toGVariantString("back\\slash")).toBe('"back\\\\slash"');
  });
});

describe("confirmation notification content", () => {
  test("keeps the command text out of the notification by default", () => {
    expect(buildConfirmNotifyRequest("command")).toEqual({
      title: "Pi Guard",
      body: "Dangerous command needs approval",
    });
    expect(buildConfirmNotifyRequest("stdin")).toEqual({
      title: "Pi Guard",
      body: "PTY input needs approval",
    });
  });

  test("appends a summarized command when one is provided", () => {
    expect(buildConfirmNotifyRequest("command", "rm -rf /tmp/build")).toEqual({
      title: "Pi Guard",
      body: "Dangerous command needs approval\nrm -rf /tmp/build",
    });
  });
});

describe("system notification delivery", () => {
  test("advances through the fallback chain until a command succeeds", async () => {
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      platform: "darwin",
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return bin === "osascript";
      },
      ringBell: () => {
        throw new Error("the bell must not ring after a delivered notification");
      },
    });

    notifier.notify(request);
    await drain();

    expect(attempted).toEqual(["terminal-notifier", "osascript"]);
  });

  test("keeps trying later commands when one rejects", async () => {
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      platform: "darwin",
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        if (bin === "terminal-notifier") throw new Error("notification tool crashed");
        return true;
      },
    });

    notifier.notify(request);
    await drain();

    expect(attempted).toEqual(["terminal-notifier", "osascript"]);
  });

  test("rings the terminal bell when every command fails", async () => {
    let bells = 0;
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      interactive: true,
      platform: "linux",
      runCommand: async () => false,
      ringBell: () => {
        bells++;
      },
    });

    notifier.notify(request);
    await drain();

    expect(bells).toBe(1);
  });

  test("rings the terminal bell on a platform without a notification tool", async () => {
    let bells = 0;
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      interactive: true,
      platform: "win32",
      runCommand: async () => {
        throw new Error("no notification command is planned on this platform");
      },
      ringBell: () => {
        bells++;
      },
    });

    notifier.notify(request);
    await drain();

    expect(bells).toBe(1);
  });

  test("stays silent when the bell is disabled", async () => {
    let bells = 0;
    const notifier = createNotifier({
      config: { ...notifyConfig, bell: false },
      env: {},
      interactive: true,
      platform: "win32",
      runCommand: async () => false,
      ringBell: () => {
        bells++;
      },
    });

    notifier.notify(request);
    await drain();

    expect(bells).toBe(0);
  });

  test("does nothing when notifications are disabled", async () => {
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: { ...notifyConfig, enabled: false },
      env: {},
      platform: "darwin",
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    await drain();

    expect(attempted).toEqual([]);
  });

  test("throttles notifications that arrive faster than the minimum interval", async () => {
    let clock = 0;
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      platform: "darwin",
      now: () => clock,
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    clock = 1_000;
    notifier.notify(request);
    clock = 2_000;
    notifier.notify(request);
    await drain();

    expect(attempted).toEqual(["terminal-notifier", "terminal-notifier"]);
  });

  test("caps how many notifications are sent per minute", async () => {
    let clock = 0;
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: { ...notifyConfig, minIntervalMs: 0, maxPerMinute: 2 },
      env: {},
      platform: "darwin",
      now: () => clock,
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    for (const second of [0, 10, 20, 30, 70]) {
      clock = second * 1_000;
      notifier.notify(request);
    }
    await drain();

    expect(attempted).toEqual(["terminal-notifier", "terminal-notifier", "terminal-notifier"]);
  });
});

describe("terminal notification delivery", () => {
  test("writes the terminal sequence and skips the system notification chain", async () => {
    const written: string[] = [];
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: { TERM_PROGRAM: "ghostty" },
      interactive: true,
      platform: "darwin",
      writeSequence: (sequence) => written.push(sequence),
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
      ringBell: () => {
        throw new Error("the bell must not ring after a terminal notification");
      },
    });

    notifier.notify(request);
    await drain();

    expect(written).toEqual(["\x1b]777;notify;Pi Guard;Dangerous command needs approval\x07"]);
    expect(attempted).toEqual([]);
  });

  test("falls back to the system notification chain on an unsupported terminal", async () => {
    const written: string[] = [];
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: { TERM: "xterm-256color" },
      interactive: true,
      platform: "darwin",
      writeSequence: (sequence) => written.push(sequence),
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    await drain();

    expect(written).toEqual([]);
    expect(attempted).toEqual(["terminal-notifier"]);
  });

  test("falls back to the system notification chain inside tmux", async () => {
    // 回归：放进 tmux 的 KITTY_WINDOW_ID 会让白名单误命中，此时若跳过 spawn 链，
    // 用户既收不到 OSC（被 tmux 丢弃）也收不到系统通知
    const written: string[] = [];
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: { TMUX: "/private/tmp/tmux-501/default,32270,8", TERM_PROGRAM: "tmux", KITTY_WINDOW_ID: "1" },
      interactive: true,
      platform: "darwin",
      writeSequence: (sequence) => written.push(sequence),
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    await drain();

    expect(written).toEqual([]);
    expect(attempted).toEqual(["terminal-notifier"]);
  });

  test("writes no terminal sequence when stdout is not an interactive terminal", async () => {
    const written: string[] = [];
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: { TERM_PROGRAM: "ghostty" },
      interactive: false,
      platform: "darwin",
      writeSequence: (sequence) => written.push(sequence),
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    await drain();

    expect(written).toEqual([]);
    expect(attempted).toEqual(["terminal-notifier"]);
  });

  test("does not ring the bell when stdout is not an interactive terminal", async () => {
    let bells = 0;
    const notifier = createNotifier({
      config: notifyConfig,
      env: {},
      interactive: false,
      platform: "win32",
      runCommand: async () => false,
      ringBell: () => {
        bells++;
      },
    });

    notifier.notify(request);
    await drain();

    expect(bells).toBe(0);
  });

  test("throttles the terminal sequence the same way as the system chain", async () => {
    let clock = 0;
    const written: string[] = [];
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
      env: { TERM_PROGRAM: "ghostty" },
      interactive: true,
      now: () => clock,
      writeSequence: (sequence) => written.push(sequence),
      runCommand: async ({ bin }) => {
        attempted.push(bin);
        return true;
      },
    });

    notifier.notify(request);
    clock = 1_000;
    notifier.notify(request);
    clock = 2_000;
    notifier.notify(request);
    await drain();

    expect(written).toHaveLength(2);
    expect(attempted).toEqual([]);
  });
});

describe("notification process runner", () => {
  test("reports success when the command exits cleanly", async () => {
    await expect(runNotifyCommand({ bin: process.execPath, args: ["-e", "process.exit(0)"] })).resolves.toBe(true);
  });

  test("reports failure when the command exits with an error code", async () => {
    await expect(runNotifyCommand({ bin: process.execPath, args: ["-e", "process.exit(3)"] })).resolves.toBe(false);
  });

  test("reports failure when the command is missing", async () => {
    await expect(runNotifyCommand({ bin: "pi-guard-missing-notify-binary", args: [] })).resolves.toBe(false);
  });

  test("kills a command that never exits", async () => {
    const killed = await runNotifyCommand({ bin: process.execPath, args: ["-e", "setTimeout(() => {}, 10_000)"] }, 200);

    expect(killed).toBe(false);
  });
});

describe("terminal notification targeting", () => {
  test("targets OSC 99 on kitty", () => {
    expect(detectTerminalNotifyTarget({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
  });

  test("targets OSC 777 on the terminals known to render it", () => {
    const supported = [
      { TERM_PROGRAM: "ghostty" },
      { GHOSTTY_RESOURCES_DIR: "/opt/homebrew/share/ghostty" },
      { TERM_PROGRAM: "WezTerm" },
      { TERM_PROGRAM: "iTerm.app" },
      { ITERM_SESSION_ID: "w0t0p0:1A2B3C" },
      { TERM_PROGRAM: "WarpTerminal" },
      { TERM: "rxvt-unicode-256color" },
    ];

    expect(supported.map((env) => detectTerminalNotifyTarget(env))).toEqual(Array(7).fill("osc777"));
  });

  test("declines bare rxvt, which does not implement the OSC 777 notification extension", () => {
    expect(detectTerminalNotifyTarget({ TERM: "rxvt" })).toBeUndefined();
  });

  test("declines unknown terminals instead of guessing", () => {
    expect(detectTerminalNotifyTarget({})).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM: "xterm-256color" })).toBeUndefined();
  });

  test("declines inside tmux even when the outer terminal identity survives", () => {
    // tmux 3.3 起把 TERM_PROGRAM 覆写成 tmux，但不清楚洗 KITTY_WINDOW_ID / ITERM_SESSION_ID，
    // 它们会原样幸存；此时误命中会让 OSC 被 tmux 丢弃、又跳过 spawn 链，用户完全收不到通知
    const tmux = { TMUX: "/private/tmp/tmux-501/default,32270,8" };

    expect(detectTerminalNotifyTarget({ ...tmux, TERM_PROGRAM: "tmux", KITTY_WINDOW_ID: "1" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ ...tmux, ITERM_SESSION_ID: "w0t1p0:1A2B3C" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ ...tmux, TERM_PROGRAM: "ghostty" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM_PROGRAM: "tmux" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM: "tmux-256color" })).toBeUndefined();
  });

  test("declines inside GNU screen", () => {
    expect(detectTerminalNotifyTarget({ STY: "1234.pts-0.host", TERM_PROGRAM: "ghostty" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM: "screen-256color" })).toBeUndefined();
  });

  test("declines terminals that drop the sequence or ship it disabled", () => {
    // WT_SESSION 与白名单同时出现是人工构造的组合，用于锁定「排除项优先于白名单」
    expect(detectTerminalNotifyTarget({ WT_SESSION: "abc", TERM_PROGRAM: "ghostty" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM_PROGRAM: "vscode" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM_PROGRAM: "Apple_Terminal" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM: "alacritty" })).toBeUndefined();
    expect(detectTerminalNotifyTarget({ TERM: "dumb" })).toBeUndefined();
  });
});

describe("terminal notification sequences", () => {
  test("builds the two-part OSC 99 sequence kitty expects", () => {
    // kitty 规范：第一段 d=0 表示通知尚未发完，第二段用 p=body 补正文且 d 缺省即视为已完成
    expect(buildTerminalNotifySequence("kitty", request)).toBe(
      "\x1b]99;i=pi-guard:d=0;Pi Guard\x1b\\" + "\x1b]99;i=pi-guard:p=body;Dangerous command needs approval\x1b\\",
    );
  });

  test("builds the OSC 777 sequence the other terminals expect", () => {
    expect(buildTerminalNotifySequence("osc777", request)).toBe(
      "\x1b]777;notify;Pi Guard;Dangerous command needs approval\x07",
    );
  });

  test("strips every character class that could end the sequence early", () => {
    // kitty 要求 payload 是 escape code safe UTF-8：不含 C0（含 ESC / BEL）、DEL、C1
    const sequence = buildTerminalNotifySequence("osc777", {
      title: "Pi Guard",
      body: "a\x07b\x1bc\u007fd\u009ce\nf\tg",
    });

    expect(sequence).toBe("\x1b]777;notify;Pi Guard;a b c d e f g\x07");
  });

  test("keeps a command body with a line break inside one sequence", () => {
    // includeCommand 开启时正文是「固定提示 + 换行 + 命令」，换行必须被压掉
    const sequence = buildTerminalNotifySequence("kitty", {
      title: "Pi Guard",
      body: "Dangerous command needs approval\nrm -rf a;b",
    });

    expect(sequence).toBe(
      "\x1b]99;i=pi-guard:d=0;Pi Guard\x1b\\" +
        "\x1b]99;i=pi-guard:p=body;Dangerous command needs approval rm -rf a,b\x1b\\",
    );
  });
});

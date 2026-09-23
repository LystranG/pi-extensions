import { describe, expect, test } from "bun:test";
import {
  buildConfirmNotifyRequest,
  createNotifier,
  escapeTerminalNotifierValue,
  planNotifyCommands,
  runNotifyCommand,
  toGVariantString,
} from "../src/notify.ts";
import type { GuardNotifyConfig } from "../src/types.ts";

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
  const notifyConfig: GuardNotifyConfig = {
    enabled: true,
    includeCommand: false,
    minIntervalMs: 1_500,
    maxPerMinute: 5,
    bell: true,
  };

  test("advances through the fallback chain until a command succeeds", async () => {
    const attempted: string[] = [];
    const notifier = createNotifier({
      config: notifyConfig,
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

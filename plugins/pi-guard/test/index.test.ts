import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmStdinInput,
  decideToolCall,
  ensureGuardConfig,
  type GuardConfig,
  loadGuardConfig,
  type NotifyRequest,
} from "../src/index.ts";

const config: GuardConfig = {
  binary: "dcg",
  defaultMode: "confirm",
  headless: "deny",
  timeoutMs: 2_000,
  rules: [],
  notify: { enabled: true, includeCommand: false, minIntervalMs: 1_500, maxPerMinute: 5, bell: true },
};

const ui = {
  confirm: async (): Promise<boolean> => true,
  notify: (): void => {},
};

describe("destructive command guard policy", () => {
  test("denies dangerous commands in deny mode", async () => {
    const result = await decideToolCall(
      "git reset --hard",
      { ...config, defaultMode: "deny" },
      async () => ({
        deny: true,
        reason: "History will be rewritten",
      }),
      { hasUI: true, mode: "tui", ui },
    );
    expect(result).toEqual({ deny: true, reason: "History will be rewritten" });
  });

  test("asks before dangerous commands in confirm mode", async () => {
    const result = await decideToolCall(
      "rm -rf ./build",
      { ...config, rules: [{ command: "rm -rf *", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Recursive deletion" }),
      { hasUI: true, mode: "tui", ui },
    );
    expect(result).toEqual({ deny: false, reason: "" });
  });

  test("denies when confirmation is declined", async () => {
    const result = await decideToolCall(
      "rm -rf ./build",
      { ...config, rules: [{ command: "rm -rf *", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Recursive deletion" }),
      { hasUI: true, mode: "tui", ui: { confirm: async () => false, notify: (): void => {} } },
    );
    expect(result.deny).toBe(true);
    expect(result.reason).toBe("User did not confirm the dangerous command");
  });

  test("uses the configured headless policy", async () => {
    const checker = async () => ({ deny: true, reason: "Dangerous" });
    const denied = await decideToolCall(
      "danger",
      { ...config, rules: [{ command: "danger", mode: "confirm" }] },
      checker,
      { hasUI: false, mode: "print", ui },
    );
    const allowed = await decideToolCall(
      "danger",
      { ...config, headless: "allow", rules: [{ command: "danger", mode: "confirm" }] },
      checker,
      {
        hasUI: false,
        mode: "print",
        ui,
      },
    );
    expect(denied.deny).toBe(true);
    expect(allowed.deny).toBe(false);
  });

  test("uses the default confirmation mode for unmatched dangerous commands", async () => {
    let confirmations = 0;
    const result = await decideToolCall(
      "node -e redirect-to-dynamic-path",
      { ...config, defaultMode: "confirm" },
      async () => ({ deny: true, reason: "Requires human approval" }),
      {
        hasUI: true,
        mode: "tui",
        ui: {
          confirm: async () => {
            confirmations++;
            return true;
          },
          notify: (): void => {},
        },
      },
    );
    expect(confirmations).toBe(1);
    expect(result).toEqual({ deny: false, reason: "" });
  });

  test("notifies the operating system before showing the confirmation dialog", async () => {
    const events: string[] = [];
    const result = await decideToolCall(
      "rm -rf /tmp/build",
      config,
      async () => ({ deny: true, reason: "Recursive deletion" }),
      {
        hasUI: true,
        mode: "tui",
        notifier: {
          notify: ({ title, body }: NotifyRequest): void => {
            events.push(`notify:${title}:${body}`);
          },
        },
        ui: {
          confirm: async (): Promise<boolean> => {
            events.push("confirm");
            return true;
          },
          notify: (): void => {},
        },
      },
    );

    expect(events).toEqual(["notify:Pi Guard:Dangerous command needs approval", "confirm"]);
    expect(result.deny).toBe(false);
  });

  test("keeps the command text out of the notification unless configured", async () => {
    const bodies: string[] = [];
    const notifier = {
      notify: ({ body }: NotifyRequest): void => {
        bodies.push(body);
      },
    };
    await decideToolCall("rm -rf /tmp/build", config, async () => ({ deny: true, reason: "Recursive deletion" }), {
      hasUI: true,
      mode: "tui",
      notifier,
      ui,
    });
    await decideToolCall(
      "rm -rf /tmp/build",
      { ...config, notify: { ...config.notify, includeCommand: true } },
      async () => ({ deny: true, reason: "Recursive deletion" }),
      {
        hasUI: true,
        mode: "tui",
        notifier,
        ui,
      },
    );

    expect(bodies).toEqual(["Dangerous command needs approval", "Dangerous command needs approval\nrm -rf /tmp/build"]);
  });

  test("does not notify when no confirmation dialog is available", async () => {
    const bodies: string[] = [];
    const result = await decideToolCall(
      "danger",
      { ...config, rules: [{ command: "danger", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Dangerous" }),
      {
        hasUI: false,
        mode: "print",
        notifier: {
          notify: ({ body }: NotifyRequest): void => {
            bodies.push(body);
          },
        },
        ui,
      },
    );

    expect(bodies).toEqual([]);
    expect(result.deny).toBe(true);
  });

  test("does not notify outside the interactive terminal", async () => {
    const bodies: string[] = [];
    const result = await decideToolCall(
      "danger",
      { ...config, rules: [{ command: "danger", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Dangerous" }),
      {
        hasUI: true,
        mode: "rpc",
        notifier: {
          notify: ({ body }: NotifyRequest): void => {
            bodies.push(body);
          },
        },
        ui,
      },
    );

    expect(bodies).toEqual([]);
    expect(result.deny).toBe(false);
  });

  test("keeps the guard decision when the notifier fails", async () => {
    const result = await decideToolCall(
      "danger",
      { ...config, rules: [{ command: "danger", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Dangerous" }),
      {
        hasUI: true,
        mode: "tui",
        notifier: {
          notify: (): void => {
            throw new Error("notifier crashed");
          },
        },
        ui,
      },
    );

    expect(result.deny).toBe(false);
  });

  test("notifies before confirming PTY input", async () => {
    const events: string[] = [];
    const decision = await confirmStdinInput("y\n", config, {
      hasUI: true,
      mode: "tui",
      notifier: {
        notify: ({ body }: NotifyRequest): void => {
          events.push(body);
        },
      },
      ui: {
        confirm: async (): Promise<boolean> => {
          events.push("confirm");
          return true;
        },
        notify: (): void => {},
      },
    });

    expect(events).toEqual(["PTY input needs approval", "confirm"]);
    expect(decision.deny).toBe(false);
  });
});

describe("configuration", () => {
  test("creates a confirm-by-default user configuration when none exists", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-guard-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-guard-cwd-"));
    const configPath = join(home, ".pi", "agent", "guard.json");
    try {
      ensureGuardConfig({}, cwd, home);
      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
        defaultMode: "confirm",
        headless: "deny",
        rules: [],
      });

      writeFileSync(configPath, JSON.stringify({ defaultMode: "deny" }));
      ensureGuardConfig({}, cwd, home);
      expect(JSON.parse(readFileSync(configPath, "utf8")).defaultMode).toBe("deny");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("loads safe defaults", () => {
    expect(loadGuardConfig({})).toEqual(config);
  });

  test("loads the configured default mode", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-guard-"));
    const configPath = join(directory, "guard.json");
    writeFileSync(configPath, JSON.stringify({ defaultMode: "confirm" }));
    try {
      expect(loadGuardConfig({ PI_GUARD_CONFIG: configPath }).defaultMode).toBe("confirm");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid configuration", () => {
    expect(() => loadGuardConfig({ DCG_PI_HEADLESS: "ignore" })).toThrow();
    expect(() => loadGuardConfig({ DCG_PI_TIMEOUT_MS: "0" })).toThrow();
  });

  test("loads the default notification settings", () => {
    expect(loadGuardConfig({}).notify).toEqual({
      enabled: true,
      includeCommand: false,
      minIntervalMs: 1_500,
      maxPerMinute: 5,
      bell: true,
    });
  });

  test("merges notification settings from the configuration file", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-guard-"));
    const configPath = join(directory, "guard.json");
    writeFileSync(configPath, JSON.stringify({ notify: { includeCommand: true, minIntervalMs: 0, bell: false } }));
    try {
      expect(loadGuardConfig({ PI_GUARD_CONFIG: configPath }).notify).toEqual({
        enabled: true,
        includeCommand: true,
        minIntervalMs: 0,
        maxPerMinute: 5,
        bell: false,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("disables notifications from the environment", () => {
    expect(loadGuardConfig({ DCG_PI_NOTIFY: "off" }).notify.enabled).toBe(false);
    expect(loadGuardConfig({ DCG_PI_NOTIFY: "on" }).notify.enabled).toBe(true);
  });

  test("rejects invalid notification configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-guard-"));
    const configPath = join(directory, "guard.json");
    const load = (notify: unknown): GuardConfig => {
      writeFileSync(configPath, JSON.stringify({ notify }));
      return loadGuardConfig({ PI_GUARD_CONFIG: configPath });
    };
    try {
      expect(() => load("off")).toThrow();
      expect(() => load({ minIntervalMs: -1 })).toThrow();
      expect(() => load({ minIntervalMs: 60_001 })).toThrow();
      expect(() => load({ maxPerMinute: 0 })).toThrow();
      expect(() => load({ maxPerMinute: 61 })).toThrow();
      expect(() => load({ enabled: "yes" })).toThrow();
      expect(() => loadGuardConfig({ DCG_PI_NOTIFY: "maybe" })).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("matches configured command rules", async () => {
    const result = await decideToolCall(
      "git reset --hard HEAD",
      {
        ...config,
        rules: [{ command: "git reset --hard *", mode: "confirm" }],
      },
      async () => ({ deny: true, reason: "History will be rewritten" }),
      { hasUI: true, mode: "tui", ui },
    );
    expect(result.deny).toBe(false);
  });

  test("allows a configured confirmation rule to override dcg allow", async () => {
    let checked = false;
    const result = await decideToolCall(
      "rm -rf /tmp/build",
      {
        ...config,
        rules: [{ command: "rm -rf *", mode: "confirm" }],
      },
      async () => {
        checked = true;
        return { deny: false, reason: "" };
      },
      { hasUI: true, mode: "tui", ui },
    );
    expect(checked).toBe(true);
    expect(result.deny).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideToolCall, ensureGuardConfig, type GuardConfig, loadGuardConfig } from "../src/index.ts";

const config: GuardConfig = {
  binary: "dcg",
  defaultMode: "confirm",
  headless: "deny",
  timeoutMs: 2_000,
  rules: [],
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
      { hasUI: true, ui },
    );
    expect(result).toEqual({ deny: true, reason: "History will be rewritten" });
  });

  test("asks before dangerous commands in confirm mode", async () => {
    const result = await decideToolCall(
      "rm -rf ./build",
      { ...config, rules: [{ command: "rm -rf *", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Recursive deletion" }),
      { hasUI: true, ui },
    );
    expect(result).toEqual({ deny: false, reason: "" });
  });

  test("denies when confirmation is declined", async () => {
    const result = await decideToolCall(
      "rm -rf ./build",
      { ...config, rules: [{ command: "rm -rf *", mode: "confirm" }] },
      async () => ({ deny: true, reason: "Recursive deletion" }),
      { hasUI: true, ui: { confirm: async () => false, notify: (): void => {} } },
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
      { hasUI: false, ui },
    );
    const allowed = await decideToolCall(
      "danger",
      { ...config, headless: "allow", rules: [{ command: "danger", mode: "confirm" }] },
      checker,
      {
        hasUI: false,
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

  test("matches configured command rules", async () => {
    const result = await decideToolCall(
      "git reset --hard HEAD",
      {
        ...config,
        rules: [{ command: "git reset --hard *", mode: "confirm" }],
      },
      async () => ({ deny: true, reason: "History will be rewritten" }),
      { hasUI: true, ui },
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
      { hasUI: true, ui },
    );
    expect(checked).toBe(true);
    expect(result.deny).toBe(false);
  });
});

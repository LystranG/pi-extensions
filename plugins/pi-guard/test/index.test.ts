import { describe, expect, test } from "bun:test";
import { decideToolCall, type GuardConfig, loadGuardConfig } from "../src/index.ts";

const config: GuardConfig = {
  binary: "dcg",
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
      config,
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
});

describe("configuration", () => {
  test("loads safe defaults", () => {
    expect(loadGuardConfig({})).toEqual(config);
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

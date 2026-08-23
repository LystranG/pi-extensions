import { describe, expect, mock, test } from "bun:test";
import {
  createSerenaHookExecutor,
  type SerenaHookAction,
  type SerenaHookExecutor,
  SerenaHooksController,
  type SerenaHookWarning,
  shouldRunSerenaRemind,
} from "../src/index.ts";

function setup(execute: SerenaHookExecutor = async () => ({ code: 0 })) {
  const calls: SerenaHookAction[] = [];
  const warnings: Array<{ action: SerenaHookAction; detail: string }> = [];
  const trackedExecute = mock(async (action: SerenaHookAction, input: Record<string, unknown>) => {
    calls.push(action);
    return execute(action, input);
  });
  const warn: SerenaHookWarning = (action, detail) => warnings.push({ action, detail });
  return { controller: new SerenaHooksController(trackedExecute), calls, warnings, warn };
}

describe("SerenaHooksController", () => {
  test("activates for every session start", async () => {
    const state = setup();
    for (const _reason of ["startup", "reload", "new", "resume", "fork"]) {
      await state.controller.sessionStart("session", state.warn);
    }
    expect(state.calls).toEqual(["activate", "activate", "activate", "activate", "activate"]);
  });

  test("reminds only before the model bash tool", async () => {
    const state = setup();
    await state.controller.beforeTool("read", { file_path: "src/index.ts" }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);
    expect(state.calls).toEqual(["remind"]);
  });

  test("reminds before native and FFF search tools", async () => {
    expect(["bash", "grep", "ffgrep", "multi_grep", "fff-multi-grep"].every(shouldRunSerenaRemind)).toBe(true);
    expect(["read", "find", "fffind", "edit", "write"].some(shouldRunSerenaRemind)).toBe(false);
  });

  test("cleans up only when Pi quits", async () => {
    const state = setup();
    for (const reason of ["reload", "new", "resume", "fork"]) {
      await state.controller.sessionShutdown(reason, "session", state.warn);
    }
    await state.controller.sessionShutdown("quit", "session", state.warn);
    expect(state.calls).toEqual(["cleanup"]);
  });

  test("uses the fixed command, argument array, and timeout", async () => {
    const calls: Array<{ command: string; args: string[]; timeout: number; input: Record<string, unknown> }> = [];
    const execute = createSerenaHookExecutor(async (command, args, options, input) => {
      calls.push({ command, args, timeout: options.timeout, input });
      return { code: 0 };
    });

    await execute("remind", { session_id: "session", tool_name: "read" });

    expect(calls).toEqual([
      {
        command: "serena-hooks",
        args: ["remind", "--client", "claude-code"],
        timeout: 10_000,
        input: { session_id: "session", tool_name: "read" },
      },
    ]);
  });

  test("warns once per failed action while continuing to retry", async () => {
    const state = setup(async () => ({ code: 1, stderr: "failed\nwith details" }));
    await state.controller.sessionStart("session", state.warn);
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);

    expect(state.calls).toEqual(["activate", "remind", "remind"]);
    expect(state.warnings).toEqual([
      { action: "activate", detail: "failed with details" },
      { action: "remind", detail: "failed with details" },
    ]);
  });

  test("resets warning deduplication for a new session", async () => {
    const state = setup(async () => {
      throw new Error("missing executable");
    });
    await state.controller.sessionStart("session", state.warn);
    await state.controller.sessionStart("session", state.warn);
    expect(state.warnings).toHaveLength(2);
  });

  test("reports killed commands without throwing", async () => {
    const state = setup(async () => ({ code: null, killed: true }));
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);
    expect(state.warnings[0]?.detail).toBe("命令超时或被终止");
  });
});

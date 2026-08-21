import { describe, expect, mock, test } from "bun:test";
import {
  createSerenaHookExecutor,
  type SerenaHookAction,
  type SerenaHookExecutor,
  SerenaHooksController,
  type SerenaHookWarning,
} from "../src/index.ts";

function setup(execute: SerenaHookExecutor = async () => ({ code: 0 })) {
  const calls: SerenaHookAction[] = [];
  const warnings: Array<{ action: SerenaHookAction; detail: string }> = [];
  const trackedExecute = mock(async (action: SerenaHookAction) => {
    calls.push(action);
    return execute(action);
  });
  const warn: SerenaHookWarning = (action, detail) => warnings.push({ action, detail });
  return { controller: new SerenaHooksController(trackedExecute), calls, warnings, warn };
}

describe("SerenaHooksController", () => {
  test("activates for every session start", async () => {
    const state = setup();
    for (const _reason of ["startup", "reload", "new", "resume", "fork"]) {
      await state.controller.sessionStart(state.warn);
    }
    expect(state.calls).toEqual(["activate", "activate", "activate", "activate", "activate"]);
  });

  test("reminds only before the model bash tool", async () => {
    const state = setup();
    await state.controller.beforeTool("read", state.warn);
    await state.controller.beforeTool("bash", state.warn);
    expect(state.calls).toEqual(["remind"]);
  });

  test("cleans up only when Pi quits", async () => {
    const state = setup();
    for (const reason of ["reload", "new", "resume", "fork"]) {
      await state.controller.sessionShutdown(reason, state.warn);
    }
    await state.controller.sessionShutdown("quit", state.warn);
    expect(state.calls).toEqual(["cleanup"]);
  });

  test("uses the fixed command, argument array, and timeout", async () => {
    const calls: Array<{ command: string; args: string[]; timeout: number }> = [];
    const execute = createSerenaHookExecutor(async (command, args, options) => {
      calls.push({ command, args, timeout: options.timeout });
      return { code: 0 };
    });

    await execute("remind");

    expect(calls).toEqual([{ command: "serena-hooks", args: ["remind"], timeout: 10_000 }]);
  });

  test("warns once per failed action while continuing to retry", async () => {
    const state = setup(async () => ({ code: 1, stderr: "failed\nwith details" }));
    await state.controller.sessionStart(state.warn);
    await state.controller.beforeTool("bash", state.warn);
    await state.controller.beforeTool("bash", state.warn);

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
    await state.controller.sessionStart(state.warn);
    await state.controller.sessionStart(state.warn);
    expect(state.warnings).toHaveLength(2);
  });

  test("reports killed commands without throwing", async () => {
    const state = setup(async () => ({ code: null, killed: true }));
    await state.controller.beforeTool("bash", state.warn);
    expect(state.warnings[0]?.detail).toBe("命令超时或被终止");
  });
});

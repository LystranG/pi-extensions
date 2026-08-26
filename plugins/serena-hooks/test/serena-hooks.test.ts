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

  test("reactivates once when sending from the first message after resume", async () => {
    const state = setup();
    await state.controller.sessionStart("session", state.warn, { resumeAtFirstMessage: true });
    await state.controller.resumeFirstMessage("session", state.warn);
    await state.controller.resumeFirstMessage("session", state.warn);
    expect(state.calls).toEqual(["activate", "activate"]);
  });

  test("does not reactivate after other session starts", async () => {
    const state = setup();
    await state.controller.sessionStart("session", state.warn, { resumeAtFirstMessage: true });
    await state.controller.sessionStart("session", state.warn);
    await state.controller.resumeFirstMessage("session", state.warn);
    expect(state.calls).toEqual(["activate", "activate"]);
  });

  test("ignores ordinary model bash calls", async () => {
    const state = setup();
    await state.controller.beforeTool("read", { file_path: "src/index.ts" }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);
    expect(state.calls).toEqual([]);
  });

  test("reminds before native and FFF search tools", async () => {
    const state = setup();
    for (const toolName of ["grep", "ffgrep", "multi_grep", "fff-multi-grep"]) {
      await state.controller.beforeTool(toolName, { pattern: "foo" }, "session", state.warn);
    }
    await state.controller.beforeTool("bash", { command: "rg foo ." }, "session", state.warn);

    expect(state.calls).toEqual(["remind", "remind", "remind", "remind", "remind"]);
  });

  test("normalizes FFF and shell search tools to Serena grep", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const state = setup(async (_action, input) => {
      inputs.push(input);
      return { code: 0 };
    });

    await state.controller.beforeTool("ffgrep", { pattern: "foo" }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "/usr/bin/rg foo ." }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "pwd" }, "session", state.warn);

    expect(inputs).toEqual([
      { session_id: "session", tool_name: "grep", tool_input: { pattern: "foo" } },
      { session_id: "session", tool_name: "grep", tool_input: { command: "/usr/bin/rg foo ." } },
    ]);
  });

  test("does not treat ordinary reads, paths, or shell commands as grep", async () => {
    expect(shouldRunSerenaRemind("grep")).toBe(true);
    expect(shouldRunSerenaRemind("ffgrep")).toBe(true);
    expect(shouldRunSerenaRemind("bash", { command: "grep foo ." })).toBe(true);
    expect(shouldRunSerenaRemind("bash", { command: "pwd" })).toBe(false);
    expect(shouldRunSerenaRemind("read", { file_path: "src/index.ts" })).toBe(false);
    expect(shouldRunSerenaRemind("find", { pattern: "src" })).toBe(false);
    expect(shouldRunSerenaRemind("fffind", { pattern: "src" })).toBe(false);
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
    await state.controller.beforeTool("bash", { command: "rg foo ." }, "session", state.warn);
    await state.controller.beforeTool("bash", { command: "rg foo ." }, "session", state.warn);

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
    await state.controller.beforeTool("bash", { command: "rg foo ." }, "session", state.warn);
    expect(state.warnings[0]?.detail).toBe("Command timed out or was terminated");
  });
});

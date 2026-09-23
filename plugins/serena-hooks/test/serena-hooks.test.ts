import { describe, expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createSerenaHookExecutor,
  createSerenaHooksExtension,
  formatDenyReason,
  type SerenaHookAction,
  type SerenaHookExecutor,
  SerenaHooksController,
  type SerenaHookWarning,
  shouldRunSerenaRemind,
} from "../src/index.ts";

/** 控制器测试用：记录动作与告警 */
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

/** 装配层测试用：捕获 Pi 事件 handler 与 sendMessage 调用 */
function harness(execute: SerenaHookExecutor) {
  const handlers = new Map<string, (event: never, ctx: never) => unknown>();
  const sent: Array<{
    message: { customType?: string; content?: unknown; display?: boolean };
    options?: { deliverAs?: string } | undefined;
  }> = [];
  const pi = {
    on(event: string, handler: (event: never, ctx: never) => unknown) {
      handlers.set(event, handler);
      return () => {};
    },
    sendMessage(
      message: { customType?: string; content?: unknown; display?: boolean },
      options?: { deliverAs?: string },
    ) {
      sent.push({ message, options });
    },
  };
  createSerenaHooksExtension(execute)(pi as unknown as ExtensionAPI);
  return { handlers, sent };
}

/** 构造与真实会话文件一致的头部结构：model_change -> thinking_level_change -> system 消息 */
function branchEntries(includeUserMessage: boolean) {
  const entries: Array<Record<string, unknown>> = [
    { type: "model_change", id: "model-1", parentId: null },
    { type: "thinking_level_change", id: "think-1", parentId: "model-1" },
    { type: "message", id: "sys-1", parentId: "think-1", message: { role: "system", content: "" } },
  ];
  if (includeUserMessage) {
    entries.push({ type: "message", id: "user-1", parentId: "sys-1", message: { role: "user", content: "hi" } });
  }
  return entries;
}

/** 构造最小可用的 ExtensionContext 替身 */
function context(entries: Array<Record<string, unknown>>) {
  return {
    hasUI: false,
    ui: { notify: () => {} },
    sessionManager: {
      getSessionId: () => "session",
      getBranch: () => entries,
    },
  };
}

/** 返回带 additionalContext 的 activate 输出 */
function activateResult(action: SerenaHookAction) {
  return {
    code: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `${action} context` },
    }),
  };
}

describe("SerenaHooksController", () => {
  test("activates for every session start", async () => {
    const state = setup();
    for (const _reason of ["startup", "reload", "new", "resume", "fork"]) {
      await state.controller.sessionStart("session", state.warn);
    }
    expect(state.calls).toEqual(["activate", "activate", "activate", "activate", "activate"]);
  });

  test("reactivates after rewinding before the first user message", async () => {
    const state = setup();
    await state.controller.sessionStart("session", state.warn);
    await state.controller.rewindActivate("session", true, state.warn);
    expect(state.calls).toEqual(["activate", "activate"]);
  });

  test("does not reactivate when the branch still contains a user message", async () => {
    const state = setup();
    await state.controller.sessionStart("session", state.warn);
    await state.controller.rewindActivate("session", false, state.warn);
    expect(state.calls).toEqual(["activate"]);
  });

  test("queues at most one rewind activation until the next user message", async () => {
    const state = setup();
    await state.controller.sessionStart("session", state.warn);
    await state.controller.rewindActivate("session", true, state.warn);
    await state.controller.rewindActivate("session", true, state.warn);
    expect(state.calls).toEqual(["activate", "activate"]);

    state.controller.completeRewindActivation();
    await state.controller.rewindActivate("session", true, state.warn);
    expect(state.calls).toEqual(["activate", "activate", "activate"]);
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

  test("cleans up on quit and session replacement but not on reload", async () => {
    const state = setup();
    await state.controller.sessionShutdown("reload", "session", state.warn);
    expect(state.calls).toEqual([]);
    for (const reason of ["quit", "new", "resume", "fork"]) {
      await state.controller.sessionShutdown(reason, "session", state.warn);
    }
    expect(state.calls).toEqual(["cleanup", "cleanup", "cleanup", "cleanup"]);
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

describe("serena hooks extension wiring", () => {
  test("sends the activation context with the next user turn on session start", async () => {
    const { handlers, sent } = harness(async (action) => activateResult(action));
    await handlers.get("session_start")?.({ reason: "new" } as never, context(branchEntries(false)) as never);

    expect(sent).toEqual([
      {
        message: { customType: "serena-hooks", content: "activate context", display: true },
        options: { deliverAs: "nextTurn" },
      },
    ]);
  });

  test("re-injects the activation context after the tree rewinds to before the first user message", async () => {
    const { handlers, sent } = harness(async (action) => activateResult(action));
    const ctx = context(branchEntries(false));

    await handlers.get("session_start")?.({ reason: "new" } as never, ctx as never);
    // navigateTree 跳到首条用户消息时，newLeafId 是该用户消息的 parentId（system 条目），而不是 null
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "sys-1", oldLeafId: "user-1" } as never,
      ctx as never,
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]?.message.content).toBe("activate context");
    expect(sent[1]?.options).toEqual({ deliverAs: "nextTurn" });
  });

  test("does not re-inject when the branch still contains a user message", async () => {
    const { handlers, sent } = harness(async (action) => activateResult(action));
    const ctx = context(branchEntries(true));

    await handlers.get("session_start")?.({ reason: "new" } as never, ctx as never);
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "user-1", oldLeafId: "assistant-1" } as never,
      ctx as never,
    );

    expect(sent).toHaveLength(1);
  });

  test("does not re-inject when the tree navigation leaves the leaf unchanged", async () => {
    const { handlers, sent } = harness(async (action) => activateResult(action));
    const ctx = context(branchEntries(false));

    await handlers.get("session_start")?.({ reason: "new" } as never, ctx as never);
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "sys-1", oldLeafId: "sys-1" } as never,
      ctx as never,
    );

    expect(sent).toHaveLength(1);
  });

  test("does not stack duplicate rewind activations before the next user message", async () => {
    const { handlers, sent } = harness(async (action) => activateResult(action));
    const ctx = context(branchEntries(false));

    await handlers.get("session_start")?.({ reason: "new" } as never, ctx as never);
    // 回退到首条用户消息之前的两个不同位置，只应排队一次激活
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "model-1", oldLeafId: "user-1" } as never,
      ctx as never,
    );
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "sys-1", oldLeafId: "model-1" } as never,
      ctx as never,
    );
    expect(sent).toHaveLength(2);

    // 用户消息发出后，下一次回退可以再次注入
    handlers.get("message_start")?.({ message: { role: "user" } } as never, ctx as never);
    await handlers.get("session_tree")?.(
      { type: "session_tree", newLeafId: "sys-1", oldLeafId: "user-2" } as never,
      ctx as never,
    );
    expect(sent).toHaveLength(3);
  });

  test("forwards Serena's additionalContext through the blocked tool result", async () => {
    const { handlers } = harness(async (action) =>
      action === "remind"
        ? {
            code: 0,
            stdout: JSON.stringify({
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: "Too many consecutive grep calls.",
                additionalContext: "Consider using Serena's symbolic tools.",
              },
            }),
          }
        : activateResult(action),
    );

    const result = await handlers.get("tool_call")?.(
      { toolName: "grep", input: { pattern: "foo" } } as never,
      context(branchEntries(true)) as never,
    );

    expect(result).toEqual({
      block: true,
      reason: "Too many consecutive grep calls.\n\nConsider using Serena's symbolic tools.",
    });
  });

  test("does not block tool calls that Serena allows", async () => {
    const { handlers } = harness(async (action) => activateResult(action));
    const result = await handlers.get("tool_call")?.(
      { toolName: "grep", input: { pattern: "foo" } } as never,
      context(branchEntries(true)) as never,
    );
    expect(result).toBeUndefined();
  });
});

describe("serena hook output", () => {
  test("joins the deny reason with the additional context", () => {
    expect(formatDenyReason({ reason: "blocked", additionalContext: "use symbolic tools" })).toBe(
      "blocked\n\nuse symbolic tools",
    );
    expect(formatDenyReason({ reason: "blocked" })).toBe("blocked");
    expect(formatDenyReason({ additionalContext: "use symbolic tools" })).toBe("use symbolic tools");
  });

  test("falls back to a default deny reason", () => {
    expect(formatDenyReason({})).toBe("Serena hook denied this tool call");
  });
});

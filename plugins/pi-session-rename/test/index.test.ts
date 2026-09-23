import { describe, expect, test } from "bun:test";
import { createSessionRenameController, type SessionRenameControllerOptions } from "../src/controller.ts";
import sessionRenameExtension from "../src/index.ts";
import { countUserMessages } from "../src/session-history.ts";
import {
  buildRetryTitlePrompt,
  buildTitlePrompt,
  countTitleLength,
  extractUserPrompt,
  generateTitle,
  isTitleWithinLimit,
  isUserOriginatedInput,
  normalizeTitle,
  type TitleGenerationResult,
} from "../src/title.ts";

/** 等待后台 promise 落地 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 构造带可变 session 名称与记录型警告的 controller 测试环境 */
function createHarness(generateTitle: SessionRenameControllerOptions["generateTitle"], initialName?: string) {
  let sessionName = initialName;
  const warnings: string[] = [];
  const controller = createSessionRenameController({
    getSessionName: () => sessionName,
    setSessionName: (name) => {
      sessionName = name;
    },
    warn: (message) => {
      warnings.push(message);
    },
    generateTitle,
  });
  return {
    controller,
    warnings,
    get sessionName(): string | undefined {
      return sessionName;
    },
  };
}

describe("isUserOriginatedInput", () => {
  test("accepts interactive and rpc input only when it is not queued", () => {
    expect(isUserOriginatedInput({ source: "interactive" })).toBe(true);
    expect(isUserOriginatedInput({ source: "rpc" })).toBe(true);
    expect(isUserOriginatedInput({ source: "extension" })).toBe(false);
    expect(isUserOriginatedInput({ source: "interactive", streamingBehavior: "steer" })).toBe(false);
    expect(isUserOriginatedInput({ source: "interactive", streamingBehavior: "followUp" })).toBe(false);
  });
});

describe("countUserMessages", () => {
  test("counts only user messages", () => {
    const entries = [
      { type: "model_change" },
      { type: "message", message: { role: "user" } },
      { type: "message", message: { role: "assistant" } },
      { type: "message", message: { role: "toolResult" } },
      { type: "session_info", name: "Existing name" },
      { type: "message", message: { role: "user" } },
    ] as never;

    expect(countUserMessages(entries)).toBe(2);
  });

  test("reports a session without entries as having no user messages", () => {
    expect(countUserMessages([])).toBe(0);
  });
});

describe("extractUserPrompt", () => {
  test("keeps the user text that follows a skill block", () => {
    const prompt = [
      '<skill name="diagnosing-bugs" location="/repo/.pi/skills/diagnosing-bugs/SKILL.md">',
      "References are relative to /repo/.pi/skills/diagnosing-bugs.",
      "",
      "# Diagnosing Bugs",
      "",
      "A discipline for hard bugs.",
      "</skill>",
      "",
      "你看看 pi-rename 插件",
    ].join("\n");
    expect(extractUserPrompt(prompt)).toBe("你看看 pi-rename 插件");
  });

  test("strips several skill blocks and keeps the remaining request", () => {
    const prompt = `<skill name="a">body a</skill>\n\n<skill name="b">body b</skill>\n\n审查这次改动`;
    expect(extractUserPrompt(prompt)).toBe("审查这次改动");
  });

  test("passes an ordinary prompt through unchanged", () => {
    expect(extractUserPrompt("  fix the login flow  ")).toBe("fix the login flow");
  });

  test("falls back to the whole prompt when a skill block carries no user text", () => {
    expect(extractUserPrompt('<skill name="a">body a</skill>')).toBe('<skill name="a">body a</skill>');
  });

  test("ignores pass-through commands, shell input, and empty prompts", () => {
    expect(extractUserPrompt("/unknown-command foo")).toBeUndefined();
    expect(extractUserPrompt("!git status")).toBeUndefined();
    expect(extractUserPrompt("   ")).toBeUndefined();
  });
});

describe("title helpers", () => {
  test("normalizes a single short title line", () => {
    expect(normalizeTitle('Title:   "Fix OAuth callback"\nHere is why')).toBe("Fix OAuth callback");
  });

  test("builds a prompt from the first user turn", () => {
    const prompt = buildTitlePrompt("Fix login");
    expect(prompt).toContain("<user-prompt>\nFix login\n</user-prompt>");
  });

  test("enforces separate Chinese-character and non-Chinese-word limits", () => {
    expect(countTitleLength("修复 OAuth 登录流程")).toEqual({ hanCharacters: 6, words: 1 });
    expect(isTitleWithinLimit("修复 OAuth 登录流程")).toBe(true);
    expect(isTitleWithinLimit("这是一个超过十个汉字的标题内容")).toBe(false);
    expect(isTitleWithinLimit("One Two Three Four Five")).toBe(true);
    expect(isTitleWithinLimit("One Two Three Four Five Six")).toBe(false);
    expect(buildRetryTitlePrompt("One Two Three Four Five Six")).toContain("exceeded the session title length limit");
  });

  test("retries an oversized model title at most three times", async () => {
    const prompts: string[] = [];
    const oversized = "One Two Three Four Five Six";
    const result = await generateTitle(
      {} as never,
      "Explain login",
      new AbortController().signal,
      async (_model, context, _options) => {
        prompts.push(context.messages[0]?.content as string);
        return {
          role: "assistant",
          content: [{ type: "text", text: oversized }],
          stopReason: "stop",
        } as never;
      },
    );

    expect(prompts).toHaveLength(4);
    expect(prompts[1]).toContain("exceeded the session title length limit");
    expect(result).toEqual({ lengthLimitExceeded: true });
  });

  test("retries a reply without any title text and then reports the failure", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const result = await generateTitle(
      {} as never,
      "Explain login",
      new AbortController().signal,
      async (_model, context) => {
        calls++;
        prompts.push(context.messages[0]?.content as string);
        return {
          role: "assistant",
          content: [{ type: "thinking", thinking: "weighing options" }],
          stopReason: "length",
        } as never;
      },
    );

    expect(calls).toBe(4);
    expect(prompts[1]).toBe(prompts[0]);
    expect(result).toEqual({ lengthLimitExceeded: false, error: "the model returned no usable title" });
  });

  test("keeps retrying until a truncated reply finally carries a title", async () => {
    let calls = 0;
    const result = await generateTitle({} as never, "Explain login", new AbortController().signal, async () => {
      calls++;
      if (calls < 3) return { role: "assistant", content: [], stopReason: "length" } as never;
      return { role: "assistant", content: [{ type: "text", text: "Login fix" }], stopReason: "stop" } as never;
    });

    expect(calls).toBe(3);
    expect(result).toEqual({ title: "Login fix", lengthLimitExceeded: false });
  });

  test("requests a budget that leaves room for thinking-only models", async () => {
    let maxTokens: number | undefined;
    await generateTitle(
      {} as never,
      "Explain login",
      new AbortController().signal,
      async (_model, _context, options) => {
        maxTokens = options.maxTokens;
        return { role: "assistant", content: [{ type: "text", text: "Login fix" }], stopReason: "stop" } as never;
      },
    );

    expect(maxTokens).toBe(1024);
  });

  test("reports a provider error instead of silently returning no title", async () => {
    const result = await generateTitle({} as never, "Explain login", new AbortController().signal, async () => {
      return {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "rate limited",
      } as never;
    });

    expect(result).toEqual({ lengthLimitExceeded: false, error: "rate limited" });
  });

  test("stays silent when the title request was aborted", async () => {
    const result = await generateTitle({} as never, "Explain login", new AbortController().signal, async () => {
      return { role: "assistant", content: [], stopReason: "aborted" } as never;
    });

    expect(result).toEqual({ lengthLimitExceeded: false });
  });
});

describe("session rename controller", () => {
  test("renames on the expanded prompt of the first user turn", async () => {
    const harness = createHarness(async (_model, _registry, candidate) => {
      expect(candidate.prompt).toBe("Fix login");
      return { title: "Fix login flow", lengthLimitExceeded: false };
    });

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Fix login", {} as never, {} as never);
    await settle();

    expect(harness.sessionName).toBe("Fix login flow");
  });

  test("names a skill-invoked session from the user's own text", async () => {
    // 回归：/skill: 调用曾因 input 文本以 "/" 开头被当成命令丢弃，skill 开头的 session 永远不会被命名
    const skillPrompt = [
      '<skill name="diagnosing-bugs" location="/repo/.pi/skills/diagnosing-bugs/SKILL.md">',
      "# Diagnosing Bugs",
      "",
      "A discipline for hard bugs.",
      "</skill>",
      "",
      "你看看 pi-rename 插件，根本不起作用",
    ].join("\n");
    const harness = createHarness(async (_model, _registry, candidate) => {
      expect(candidate.prompt).toBe("你看看 pi-rename 插件，根本不起作用");
      return { title: "Rename Plugin Broken", lengthLimitExceeded: false };
    });

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart(skillPrompt, {} as never, {} as never);
    await settle();

    expect(harness.sessionName).toBe("Rename Plugin Broken");
  });

  test("ignores turns started by extension input", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { title: "Should not happen", lengthLimitExceeded: false };
    });

    harness.controller.onInput({ source: "extension" });
    harness.controller.onBeforeAgentStart("Injected request", {} as never, {} as never);
    await settle();

    expect(calls).toBe(0);
    expect(harness.sessionName).toBeUndefined();
  });

  test("ignores queued steering and follow-up input", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { title: "Should not happen", lengthLimitExceeded: false };
    });

    harness.controller.onInput({ source: "interactive", streamingBehavior: "steer" });
    harness.controller.onBeforeAgentStart("Queued request", {} as never, {} as never);
    harness.controller.onInput({ source: "interactive", streamingBehavior: "followUp" });
    harness.controller.onBeforeAgentStart("Queued follow-up", {} as never, {} as never);
    await settle();

    expect(calls).toBe(0);
  });

  test("only the first user turn starts a rename", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { title: "First request", lengthLimitExceeded: false };
    });

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("First request", {} as never, {} as never);
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Second request", {} as never, {} as never);
    await settle();

    expect(calls).toBe(1);
    expect(harness.sessionName).toBe("First request");
  });

  test("does not overwrite an existing session name", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { title: "Should not happen", lengthLimitExceeded: false };
    }, "Existing name");

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Fix login", {} as never, {} as never);
    await settle();

    expect(calls).toBe(0);
    expect(harness.sessionName).toBe("Existing name");
  });

  test("warns when no model is available at turn start and still names a later turn", async () => {
    const harness = createHarness(async () => ({ title: "Retry after model setup", lengthLimitExceeded: false }));

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("No model request", undefined, {} as never);
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Completed request", {} as never, {} as never);
    await settle();

    expect(harness.warnings).toEqual(["Session title generation skipped because no model is available."]);
    expect(harness.sessionName).toBe("Retry after model setup");
  });

  test("warns when the background title request fails", async () => {
    const harness = createHarness(async () => {
      throw new Error("provider unavailable");
    });

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Provider failure", {} as never, {} as never);
    await settle();

    expect(harness.warnings).toEqual(["Session title generation failed: provider unavailable"]);
    expect(harness.sessionName).toBeUndefined();
  });

  test("warns when the provider returns an error result", async () => {
    const harness = createHarness(async () => ({ lengthLimitExceeded: false, error: "rate limited" }));

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Provider error", {} as never, {} as never);
    await settle();

    expect(harness.warnings).toEqual(["Session title generation failed: rate limited"]);
  });

  test("warns in English after title length retries are exhausted", async () => {
    const harness = createHarness(async () => ({ lengthLimitExceeded: true }));

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Long title request", {} as never, {} as never);
    await settle();

    expect(harness.warnings).toEqual([
      "Session title generation stopped after 3 retries because the title exceeded the length limit.",
    ]);
  });

  test("aborts the background request on session shutdown", () => {
    let signal: AbortSignal | undefined;
    const harness = createHarness(async (_model, _registry, _candidate, requestSignal) => {
      signal = requestSignal;
      return new Promise(() => undefined);
    });

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Long request", {} as never, {} as never);
    harness.controller.onSessionShutdown();

    expect(signal?.aborted).toBe(true);
  });

  test("does not let an old title request rename a new session", async () => {
    let resolveTitle: ((result: TitleGenerationResult) => void) | undefined;
    const harness = createHarness(
      async () =>
        new Promise<TitleGenerationResult>((resolve) => {
          resolveTitle = resolve;
        }),
    );

    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Old session", {} as never, {} as never);
    harness.controller.onSessionShutdown();
    harness.controller.onSessionStart({ existingUserMessages: 0 });
    resolveTitle?.({ title: "Old title", lengthLimitExceeded: false });
    await settle();

    expect(harness.sessionName).toBeUndefined();
  });

  test("does not rename a session that already contains user messages", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { title: "Should not happen", lengthLimitExceeded: false };
    });

    harness.controller.onSessionStart({ existingUserMessages: 1 });
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Resumed request", {} as never, {} as never);
    await settle();

    expect(calls).toBe(0);
    expect(harness.sessionName).toBeUndefined();
  });

  test("still names a new session that starts without history", async () => {
    const harness = createHarness(async (_model, _registry, candidate) => {
      expect(candidate.prompt).toBe("Fresh request");
      return { title: "Fresh request", lengthLimitExceeded: false };
    });

    harness.controller.onSessionStart({ existingUserMessages: 0 });
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Fresh request", {} as never, {} as never);
    await settle();

    expect(harness.sessionName).toBe("Fresh request");
  });

  test("does not retry naming on a later message when the first attempt produced no title", async () => {
    let calls = 0;
    const harness = createHarness(async () => {
      calls++;
      return { lengthLimitExceeded: false, error: "the model returned no usable title" };
    });

    harness.controller.onSessionStart({ existingUserMessages: 0 });
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("First request", {} as never, {} as never);
    await settle();
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Second request", {} as never, {} as never);
    await settle();

    expect(calls).toBe(1);
    expect(harness.warnings).toEqual(["Session title generation failed: the model returned no usable title"]);
  });

  test("keeps the in-flight title request alive when a later message arrives", async () => {
    let resolveTitle: ((result: TitleGenerationResult) => void) | undefined;
    const harness = createHarness(
      async () =>
        new Promise<TitleGenerationResult>((resolve) => {
          resolveTitle = resolve;
        }),
    );

    harness.controller.onSessionStart({ existingUserMessages: 0 });
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("First request", {} as never, {} as never);
    harness.controller.onInput({ source: "interactive" });
    harness.controller.onBeforeAgentStart("Second request", {} as never, {} as never);
    resolveTitle?.({ title: "First request title", lengthLimitExceeded: false });
    await settle();

    expect(harness.sessionName).toBe("First request title");
  });
});

/** 用假的 ExtensionAPI 驱动扩展入口，按事件名捕获它注册的处理器 */
function createExtensionHarness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const notifications: string[] = [];
  let sessionName: string | undefined;

  sessionRenameExtension({
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    getSessionName: () => sessionName,
    setSessionName: (name: string) => {
      sessionName = name;
    },
  } as never);

  return {
    /** 触发扩展注册的事件处理器 */
    emit: async (event: string, payload: unknown, ctx: unknown): Promise<void> => {
      await handlers.get(event)?.(payload, ctx);
    },
    /** 构造只包含被测代码会用到字段的扩展上下文 */
    createContext: (options: { model: unknown; modelRegistry: unknown; sessionId?: string; entries?: unknown[] }) => ({
      model: options.model,
      modelRegistry: options.modelRegistry,
      sessionManager: {
        getSessionId: () => options.sessionId ?? "sess-1",
        getEntries: () => options.entries ?? [],
      },
      ui: { notify: (message: string) => notifications.push(message) },
    }),
    notifications,
    get sessionName(): string | undefined {
      return sessionName;
    },
  };
}

describe("session rename extension", () => {
  test("sends the opencode routing headers for the session's model", async () => {
    const requests: { transformHeaders?: (headers: Record<string, string>) => Record<string, string> }[] = [];
    const harness = createExtensionHarness();
    const ctx = harness.createContext({
      model: { provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" },
      modelRegistry: {
        complete: async (_model: unknown, _context: unknown, options: never) => {
          requests.push(options);
          return { role: "assistant", content: [{ type: "text", text: "Opencode session" }], stopReason: "stop" };
        },
      },
      sessionId: "sess-42",
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await harness.emit("input", { type: "input", source: "interactive", text: "name me" }, ctx);
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "name me" }, ctx);
    await settle();

    expect(requests[0]?.transformHeaders?.({})).toEqual({
      "x-opencode-session": "sess-42",
      "x-opencode-client": "pi",
    });
    expect(harness.sessionName).toBe("Opencode session");
  });

  test("does not add routing headers for unrelated providers", async () => {
    const requests: { transformHeaders?: unknown }[] = [];
    const harness = createExtensionHarness();
    const ctx = harness.createContext({
      model: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
      modelRegistry: {
        complete: async (_model: unknown, _context: unknown, options: never) => {
          requests.push(options);
          return { role: "assistant", content: [{ type: "text", text: "Unrelated session" }], stopReason: "stop" };
        },
      },
      sessionId: "sess-42",
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await harness.emit("input", { type: "input", source: "interactive", text: "name me" }, ctx);
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "name me" }, ctx);
    await settle();

    expect(requests[0]?.transformHeaders).toBeUndefined();
    expect(harness.sessionName).toBe("Unrelated session");
  });

  test("does not rename a session that was resumed with history", async () => {
    let calls = 0;
    const harness = createExtensionHarness();
    const ctx = harness.createContext({
      model: { provider: "openai", baseUrl: "https://api.openai.com/v1" },
      modelRegistry: {
        complete: async () => {
          calls++;
          return { role: "assistant", content: [{ type: "text", text: "Should not happen" }], stopReason: "stop" };
        },
      },
      entries: [{ type: "message", message: { role: "user" } }],
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await harness.emit("input", { type: "input", source: "interactive", text: "name me" }, ctx);
    await harness.emit("before_agent_start", { type: "before_agent_start", prompt: "name me" }, ctx);
    await settle();

    expect(calls).toBe(0);
    expect(harness.sessionName).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { createSessionRenameController } from "../src/controller.ts";
import {
  buildRetryTitlePrompt,
  buildTitlePrompt,
  countTitleLength,
  generateTitle,
  isEligibleInput,
  isTitleWithinLimit,
  normalizeTitle,
  type TitleGenerationResult,
} from "../src/title.ts";

describe("isEligibleInput", () => {
  test("accepts the first ordinary interactive prompt", () => {
    expect(isEligibleInput({ text: "  fix the auth flow  ", source: "interactive" })).toBe(true);
  });

  test("rejects commands, extension input, and queued streaming input", () => {
    expect(isEligibleInput({ text: "/name project", source: "interactive" })).toBe(false);
    expect(isEligibleInput({ text: "!git status", source: "interactive" })).toBe(false);
    expect(isEligibleInput({ text: "follow up", source: "extension" })).toBe(false);
    expect(isEligibleInput({ text: "steer this", source: "interactive", streamingBehavior: "steer" })).toBe(false);
    expect(isEligibleInput({ text: "queue this", source: "interactive", streamingBehavior: "followUp" })).toBe(false);
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
      async (_model, context) => {
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
});

describe("session rename controller", () => {
  test("starts one background rename after a settled idle turn", async () => {
    let sessionName: string | undefined;
    let resolveTitle: ((title: TitleGenerationResult) => void) | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async (_model, _modelRegistry, candidate, signal) =>
        new Promise((resolve) => {
          expect(candidate.prompt).toBe("Fix login");
          expect(signal.aborted).toBe(false);
          resolveTitle = resolve;
        }),
      warn: () => undefined,
    });

    controller.onInput({ text: "Fix login", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    resolveTitle?.({ title: "Fix login flow", lengthLimitExceeded: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionName).toBe("Fix login flow");
  });

  test("starts naming at the first final turn and ignores later queued turns", async () => {
    let sessionName: string | undefined;
    let calls = 0;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async (_model, _registry, candidate) => {
        calls++;
        expect(candidate.prompt).toBe("First request");
        return { title: "First request", lengthLimitExceeded: false };
      },
      warn: () => undefined,
    });

    controller.onInput({ text: "First request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "toolUse" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onInput({ text: "Queued follow-up", source: "interactive", streamingBehavior: "followUp" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(sessionName).toBe("First request");
  });

  test("waits through a retry after a network error", async () => {
    let sessionName: string | undefined;
    let calls = 0;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async () => {
        calls++;
        return { title: "Retry succeeded", lengthLimitExceeded: false };
      },
      warn: () => undefined,
    });

    controller.onInput({ text: "Retry request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "error" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(sessionName).toBe("Retry succeeded");
  });

  test("drops an exhausted failed turn so a later prompt can be named", async () => {
    let sessionName: string | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async () => ({ title: "Later request", lengthLimitExceeded: false }),
      warn: () => undefined,
    });

    controller.onInput({ text: "Failed request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "error" });
    controller.onAgentSettled();
    controller.onInput({ text: "Later request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionName).toBe("Later request");
  });

  test("does not rename after an interrupted first response", () => {
    let called = false;
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      generateTitle: async () => {
        called = true;
        return { title: "Should not happen", lengthLimitExceeded: false };
      },
      warn: () => undefined,
    });

    controller.onInput({ text: "Interrupted request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "aborted" });
    controller.onAgentSettled();

    expect(called).toBe(false);
  });

  test("allows a later ordinary turn after an interruption", async () => {
    let sessionName: string | undefined;
    let calls = 0;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async () => {
        calls++;
        return { title: "Later completed turn", lengthLimitExceeded: false };
      },
      warn: () => undefined,
    });

    controller.onInput({ text: "Interrupted request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "aborted" });
    controller.onAgentSettled();

    controller.onInput({ text: "Completed request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(sessionName).toBe("Later completed turn");
  });

  test("does not get stuck when the first completed turn has no model", () => {
    const warnings: string[] = [];
    let calls = 0;
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      generateTitle: async () => {
        calls++;
        return { title: "Should not happen", lengthLimitExceeded: false };
      },
      warn: (message) => warnings.push(message),
    });

    controller.onInput({ text: "No model request", source: "interactive" });
    controller.onTurnEnd(undefined, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onAgentSettled();
    controller.onInput({ text: "Retry after model setup", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });

    expect(calls).toBe(1);
    expect(warnings).toEqual(["Session title generation skipped because no model is available."]);
  });

  test("warns when the background title request fails", async () => {
    const warnings: string[] = [];
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      generateTitle: async () => {
        throw new Error("provider unavailable");
      },
      warn: (message) => warnings.push(message),
    });

    controller.onInput({ text: "Provider failure", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnings).toEqual(["Session title generation failed: provider unavailable"]);
  });

  test("aborts the background request on session shutdown", () => {
    let signal: AbortSignal | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      generateTitle: async (_model, _modelRegistry, _candidate, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
      warn: () => undefined,
    });

    controller.onInput({ text: "Long request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onSessionShutdown();

    expect(signal?.aborted).toBe(true);
  });

  test("does not let an old title request rename a new session", async () => {
    let sessionName: string | undefined;
    let resolveTitle: ((title: TitleGenerationResult) => void) | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async () =>
        new Promise((resolve) => {
          resolveTitle = resolve;
        }),
      warn: () => undefined,
    });

    controller.onInput({ text: "Old session", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onSessionShutdown();
    controller.onSessionStart();
    resolveTitle?.({ title: "Old title", lengthLimitExceeded: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionName).toBeUndefined();
  });

  test("warns in English after title length retries are exhausted", async () => {
    const warnings: string[] = [];
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      warn: (message) => warnings.push(message),
      generateTitle: async () => ({ lengthLimitExceeded: true }),
    });

    controller.onInput({ text: "Long title request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnings).toEqual([
      "Session title generation stopped after 3 retries because the title exceeded the length limit.",
    ]);
  });
});

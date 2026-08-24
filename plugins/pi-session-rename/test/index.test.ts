import { describe, expect, test } from "bun:test";
import { createSessionRenameController } from "../src/controller.ts";
import { buildTitlePrompt, isEligibleInput, normalizeTitle } from "../src/title.ts";

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
});

describe("session rename controller", () => {
  test("starts one background rename after a settled idle turn", async () => {
    let sessionName: string | undefined;
    let resolveTitle: ((title: string) => void) | undefined;
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
    });

    controller.onInput({ text: "Fix login", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    resolveTitle?.("Fix login flow");
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
        return "First request";
      },
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
        return "Retry succeeded";
      },
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
      generateTitle: async () => "Later request",
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
        return "Should not happen";
      },
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
        return "Later completed turn";
      },
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

  test("aborts the background request on session shutdown", () => {
    let signal: AbortSignal | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => undefined,
      setSessionName: () => undefined,
      generateTitle: async (_model, _modelRegistry, _candidate, requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
    });

    controller.onInput({ text: "Long request", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onSessionShutdown();

    expect(signal?.aborted).toBe(true);
  });

  test("does not let an old title request rename a new session", async () => {
    let sessionName: string | undefined;
    let resolveTitle: ((title: string) => void) | undefined;
    const controller = createSessionRenameController({
      getSessionName: () => sessionName,
      setSessionName: (name) => {
        sessionName = name;
      },
      generateTitle: async () =>
        new Promise((resolve) => {
          resolveTitle = resolve;
        }),
    });

    controller.onInput({ text: "Old session", source: "interactive" });
    controller.onTurnEnd({} as never, {} as never, { role: "assistant", stopReason: "stop" });
    controller.onSessionShutdown();
    controller.onSessionStart();
    resolveTitle?.("Old title");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionName).toBeUndefined();
  });
});

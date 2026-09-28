/** 通过扩展命令与会话事件验证手动智能重命名，不访问真实模型 */
import { expect, test } from "bun:test";
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import sessionRenameExtension from "../src/index.ts";
import type { TitleRequestOptions } from "../src/title.ts";

/** 模拟模型正文，保留 SDK 所要求的完整消息结构 */
function titleReply(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

/** 可由测试控制完成顺序的模型请求 */
interface PendingRequest {
  /** 调用时固定的模型 */
  model: Model<Api>;
  /** 调用时固定的命名上下文 */
  context: Context;
  /** 请求取消信号与 provider 选项 */
  options: TitleRequestOptions & { transformHeaders?: (headers: Record<string, string>) => Record<string, string> };
  /** 返回模型响应，故意允许已取消的请求返回以验证提交保护 */
  resolve: (message: AssistantMessage) => void;
}

/** 等待独立标题请求的 promise 回调完成 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 使用真实内存会话，仅替换 Pi 宿主与模型网络边界 */
function createHarness(initialName = "Manually chosen name", hasModel = true) {
  const session = SessionManager.inMemory("/tmp/pi-session-rename-test");
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCommandContext) => unknown>();
  const requests: PendingRequest[] = [];
  const notifications: string[] = [];
  let name: string | undefined = initialName || undefined;
  const ctx = {
    model: hasModel
      ? ({
          id: "gpt-4o",
          name: "Test model",
          api: "openai-completions",
          provider: "openai",
          baseUrl: "https://example.test/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        } satisfies Model<Api>)
      : undefined,
    sessionManager: session,
    modelRegistry: {
      complete: (model: Model<Api>, context: Context, options: PendingRequest["options"]) =>
        new Promise<AssistantMessage>((resolve) => requests.push({ model, context, options, resolve })),
    },
    ui: { notify: (message: string) => notifications.push(message) },
    waitForIdle: () => {
      throw new Error("The command must not wait for the main agent");
    },
    isIdle: () => false,
  };
  // 宿主边界只实现此扩展消费的公开 API，业务逻辑与会话树使用真实实现
  sessionRenameExtension({
    on: (event: string, handler: (event: unknown, ctx: ExtensionCommandContext) => unknown) =>
      handlers.set(event, handler),
    registerCommand: (
      command: string,
      options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ) => commands.set(command, options),
    getSessionName: () => name,
    setSessionName: (value: string) => {
      name = value;
    },
  } as unknown as ExtensionAPI);
  return {
    session,
    ctx,
    requests,
    notifications,
    /** 读取已发出的请求，缺少请求时给出明确的失败原因 */
    request: (index: number): PendingRequest => {
      const request = requests[index];
      if (!request) throw new Error(`Model request ${index} was not started`);
      return request;
    },
    get name() {
      return name;
    },
    /** 通过注册的公开命令执行，缺少命令时明确失败 */
    command: async (args = "") => {
      const command = commands.get("auto-rename");
      if (!command) throw new Error("/auto-rename is not registered");
      await command.handler(args, ctx as unknown as ExtensionCommandContext);
    },
    /** 驱动 Pi 公开会话生命周期事件 */
    emit: async (event: string, payload: unknown = {}) =>
      handlers.get(event)?.(payload, ctx as unknown as ExtensionCommandContext),
  };
}

test("an empty manual command preserves the first automatic naming opportunity", async () => {
  const harness = createHarness("");
  await harness.emit("session_start");
  await harness.command();
  expect(harness.requests).toHaveLength(0);
  await harness.emit("input", { source: "interactive", text: "实现 OAuth 登录" });
  await harness.emit("before_agent_start", { prompt: "实现 OAuth 登录" });
  expect(harness.requests).toHaveLength(1);
  harness.request(0).resolve(titleReply("实现 OAuth 登录"));
  await settle();
  expect(harness.name).toBe("实现 OAuth 登录");
});

test("/auto-rename immediately renames a resumed, named session from its conversation", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  harness.session.appendMessage(titleReply("已经实现回调校验"));
  harness.session.appendMessage({ role: "user", content: "接着补充回归测试", timestamp: 1 });
  await harness.emit("session_start");
  await harness.command();
  expect(harness.requests).toHaveLength(1);
  const request = harness.request(0);
  const source = String(request.context.messages[0]?.content);
  expect(source).toContain("实现 OAuth 登录");
  expect(source).toContain("已经实现回调校验");
  expect(source).toContain("接着补充回归测试");
  expect(request.context.systemPrompt).toContain("overall");
  expect(harness.name).toBe("Manually chosen name");
  request.resolve(titleReply("实现 OAuth 登录与回归测试"));
  await settle();
  expect(harness.name).toBe("实现 OAuth 登录与回归测试");
  expect(harness.notifications.some((message) => message.includes("实现 OAuth 登录与回归测试"))).toBe(true);
});

test("/auto-rename preserves branch summaries and removes injected or hidden content", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "OBSOLETE_RAW_HISTORY", timestamp: 0 });
  const kept = harness.session.appendMessage({
    role: "user",
    content: '<skill name="review">INJECTED_SKILL_BODY</skill>\n检查 OAuth 回调',
    timestamp: 1,
  });
  harness.session.appendMessage({
    ...titleReply("回调需要校验 state"),
    content: [
      { type: "thinking", thinking: "HIDDEN_REASONING" },
      { type: "text", text: "回调需要校验 state" },
    ],
  });
  harness.session.appendMessage({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    content: [{ type: "text", text: "RAW_TOOL_OUTPUT" }],
    isError: false,
    timestamp: 2,
  });
  const compacted = harness.session.appendCompaction("会话主线是实现 OAuth 登录", kept, 1000);
  harness.session.appendMessage({ role: "user", content: "UNRELATED_BRANCH", timestamp: 3 });
  harness.session.branch(compacted);
  harness.session.appendMessage({ role: "user", content: "补充安全测试", timestamp: 4 });
  await harness.command();
  const source = String(harness.requests[0]?.context.messages[0]?.content);
  expect(source).toContain("会话主线是实现 OAuth 登录");
  expect(source).toContain("检查 OAuth 回调");
  expect(source).toContain("回调需要校验 state");
  expect(source).toContain("补充安全测试");
  for (const noise of [
    "OBSOLETE_RAW_HISTORY",
    "INJECTED_SKILL_BODY",
    "HIDDEN_REASONING",
    "RAW_TOOL_OUTPUT",
    "UNRELATED_BRANCH",
  ]) {
    expect(source).not.toContain(noise);
  }
});

test("/auto-rename bounds long context without losing the task origin or latest progress", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "compressed history", timestamp: 0 });
  const kept = harness.session.appendMessage({
    role: "user",
    content: `TASK_ORIGIN: 实现 OAuth 登录\n${"original details ".repeat(3000)}`,
    timestamp: 1,
  });
  harness.session.appendCompaction(`SUMMARY_GOAL: 完成登录功能\n${"summary details ".repeat(3000)}`, kept, 20000);
  for (let index = 0; index < 20; index++) {
    harness.session.appendMessage(titleReply(`Progress ${index}: ${"implementation details ".repeat(300)}`));
  }
  harness.session.appendMessage({ role: "user", content: "LATEST_PROGRESS: 为 OAuth 回调补充回归测试", timestamp: 2 });
  await harness.command();
  const source = String(harness.requests[0]?.context.messages[0]?.content);
  expect(source).toContain("SUMMARY_GOAL");
  expect(source).toContain("TASK_ORIGIN");
  expect(source).toContain("LATEST_PROGRESS");
  expect(source).toContain("omitted");
  expect(source.length).toBeLessThanOrEqual(16000 + "<conversation>\n\n</conversation>".length);
});

test("a superseded request cannot retry or overwrite the latest command", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  await harness.command();
  const oldRequest = harness.request(0);
  harness.session.appendMessage({ role: "user", content: "补充 OAuth 测试", timestamp: 1 });
  await harness.command();
  const latestRequest = harness.request(1);
  expect(oldRequest.options.signal.aborted).toBe(true);
  latestRequest.resolve(titleReply("完善 OAuth 登录测试"));
  await settle();
  oldRequest.resolve(titleReply("One Two Three Four Five Six Seven Eight Nine Ten Eleven"));
  await settle();
  expect(harness.requests).toHaveLength(2);
  expect(harness.name).toBe("完善 OAuth 登录测试");
  expect(harness.notifications.filter((message) => message.startsWith("Session renamed to:"))).toHaveLength(1);
});

test.each(["session_shutdown", "session_start", "session_tree"])(
  "%s invalidates pending titles even when the provider returns later",
  async (event) => {
    const harness = createHarness();
    harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
    await harness.command();
    const request = harness.request(0);
    await harness.emit(event);
    expect(request.options.signal.aborted).toBe(true);
    request.resolve(titleReply("迟到的 OAuth 标题"));
    await settle();
    expect(harness.name).toBe("Manually chosen name");
    expect(harness.notifications).toEqual(["Generating session title..."]);
  },
);

test("manual failure keeps the old name and invalidates in-flight automatic naming", async () => {
  const harness = createHarness("");
  await harness.emit("session_start");
  await harness.emit("input", { source: "interactive", text: "实现 OAuth 登录" });
  await harness.emit("before_agent_start", { prompt: "实现 OAuth 登录" });
  const automatic = harness.request(0);
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  await harness.command();
  const manual = harness.request(1);
  expect(automatic.options.signal.aborted).toBe(true);
  manual.resolve({ ...titleReply(""), stopReason: "error", errorMessage: "provider unavailable" });
  automatic.resolve(titleReply("旧的自动标题"));
  await settle();
  expect(harness.name).toBeUndefined();
  expect(harness.notifications).toContain("Session title generation failed: provider unavailable");
  await harness.emit("input", { source: "interactive", text: "继续" });
  await harness.emit("before_agent_start", { prompt: "继续" });
  expect(harness.requests).toHaveLength(2);
});

test("a snapshot stays fixed while the main conversation and selected model advance", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  await harness.command();
  const request = harness.request(0);
  harness.session.appendMessage({ role: "user", content: "NEWER_MESSAGE", timestamp: 1 });
  await harness.emit("input", { source: "interactive", text: "NEWER_MESSAGE" });
  await harness.emit("before_agent_start", { prompt: "NEWER_MESSAGE" });
  if (!harness.ctx.model) throw new Error("Missing fixture model");
  harness.ctx.model = { ...harness.ctx.model, id: "different-model" };
  expect(String(request.context.messages[0]?.content)).not.toContain("NEWER_MESSAGE");
  expect(request.model.id).toBe("gpt-4o");
  expect(request.options.signal.aborted).toBe(false);
  request.resolve(titleReply("实现 OAuth 登录"));
  await settle();
  expect(harness.name).toBe("实现 OAuth 登录");
});

test.each([
  {
    kind: "provider error",
    replies: [{ ...titleReply(""), stopReason: "error" as const, errorMessage: "rate limited" }],
    warning: "rate limited",
  },
  {
    kind: "oversized titles",
    replies: Array.from({ length: 2 }, () => titleReply("One Two Three Four Five Six Seven Eight Nine Ten Eleven")),
    warning: "length limit",
  },
  { kind: "empty replies", replies: Array.from({ length: 4 }, () => titleReply("")), warning: "no usable title" },
])("$kind preserve the existing name with bounded retries", async ({ replies, warning }) => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  await harness.command();
  for (const [index, reply] of replies.entries()) {
    const request = harness.request(index);
    expect(request.context.systemPrompt).toContain("overall");
    expect(String(request.context.messages[0]?.content)).toContain("<conversation>");
    request.resolve(reply);
    await settle();
  }
  expect(harness.requests).toHaveLength(replies.length);
  expect(harness.name).toBe("Manually chosen name");
  expect(harness.notifications.some((message) => message.includes(warning))).toBe(true);
});

test("an empty or skill-only snapshot does not make a model request", async () => {
  const harness = createHarness();
  await harness.command();
  harness.session.appendMessage({
    role: "user",
    content: '<skill name="review">Only injected instructions</skill>',
    timestamp: 0,
  });
  await harness.command();
  expect(harness.requests).toHaveLength(0);
  expect(harness.name).toBe("Manually chosen name");
  expect(harness.notifications.every((message) => message.includes("no conversation context"))).toBe(true);
});

test("a missing model keeps the existing name and reports why generation was skipped", async () => {
  const harness = createHarness("Existing name", false);
  harness.session.appendMessage({ role: "user", content: "实现 OAuth 登录", timestamp: 0 });
  await harness.command();
  expect(harness.requests).toHaveLength(0);
  expect(harness.name).toBe("Existing name");
  expect(harness.notifications).toEqual(["Session title generation skipped because no model is available."]);
});

test("a null leaf does not accidentally name another branch", async () => {
  const harness = createHarness();
  harness.session.appendMessage({ role: "user", content: "ANOTHER_BRANCH", timestamp: 0 });
  harness.session.resetLeaf();
  await harness.command();
  expect(harness.requests).toHaveLength(0);
  expect(harness.name).toBe("Manually chosen name");
});

test("manual naming retains opencode session routing and source semantics on retry", async () => {
  const harness = createHarness();
  if (!harness.ctx.model) throw new Error("Missing fixture model");
  harness.ctx.model = { ...harness.ctx.model, provider: "opencode", baseUrl: "https://opencode.ai/zen/v1" };
  harness.session.appendMessage({ role: "user", content: "修复 OAuth 登录", timestamp: 0 });
  await harness.command();
  const first = harness.request(0);
  expect(first.options.transformHeaders?.({})).toEqual({
    "x-opencode-session": harness.session.getSessionId(),
    "x-opencode-client": "pi",
  });
  first.resolve(titleReply("One Two Three Four Five Six Seven Eight Nine Ten Eleven"));
  await settle();
  const retry = harness.request(1);
  expect(retry.context.systemPrompt).toBe(first.context.systemPrompt);
  expect(String(retry.context.messages[0]?.content)).toContain("修复 OAuth 登录");
  expect(retry.options.transformHeaders?.({})).toEqual(first.options.transformHeaders?.({}));
  retry.resolve(titleReply("修复 OAuth 登录"));
  await settle();
  expect(harness.name).toBe("修复 OAuth 登录");
});

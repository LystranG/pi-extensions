import { describe, expect, test } from "bun:test";
import { buildHeaderTransform } from "../src/adapters/index.ts";
import { isOpenCodeModel, openCodeSessionHeaders } from "../src/adapters/opencode.ts";

/** opencode 系的目录模型形状，只保留适配器关心的两个字段 */
const openCodeGoModel = { provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" };
const openAiModel = { provider: "openai", baseUrl: "https://api.openai.com/v1" };

describe("isOpenCodeModel", () => {
  test("accepts the opencode provider ids", () => {
    expect(isOpenCodeModel({ provider: "opencode", baseUrl: "https://opencode.ai/zen" })).toBe(true);
    expect(isOpenCodeModel(openCodeGoModel)).toBe(true);
  });

  test("accepts any provider served from the opencode.ai host", () => {
    expect(isOpenCodeModel({ provider: "custom-proxy", baseUrl: "https://opencode.ai/v1" })).toBe(true);
  });

  test("rejects other providers", () => {
    expect(isOpenCodeModel(openAiModel)).toBe(false);
    expect(isOpenCodeModel({ provider: "deepseek", baseUrl: "https://api.deepseek.com/v1" })).toBe(false);
  });

  test("rejects hostnames that only contain the opencode host as a substring", () => {
    expect(isOpenCodeModel({ provider: "custom-proxy", baseUrl: "https://opencode.ai.example.com/v1" })).toBe(false);
    expect(isOpenCodeModel({ provider: "custom-proxy", baseUrl: "https://not-opencode.ai/v1" })).toBe(false);
  });

  test("rejects a base url that cannot be parsed", () => {
    expect(isOpenCodeModel({ provider: "custom-proxy", baseUrl: "opencode.ai" })).toBe(false);
  });
});

describe("openCodeSessionHeaders", () => {
  test("returns both routing headers for a session id", () => {
    expect(openCodeSessionHeaders("sess-1")).toEqual({
      "x-opencode-session": "sess-1",
      "x-opencode-client": "pi",
    });
  });

  test("returns nothing without a session id", () => {
    expect(openCodeSessionHeaders(undefined)).toBeUndefined();
  });
});

describe("buildHeaderTransform", () => {
  test("adds the routing headers for an opencode model", () => {
    const transform = buildHeaderTransform(openCodeGoModel, "sess-1");

    expect(transform?.({ "x-existing": "1" })).toEqual({
      "x-existing": "1",
      "x-opencode-session": "sess-1",
      "x-opencode-client": "pi",
    });
  });

  test("stays out of the way for unrelated providers", () => {
    expect(buildHeaderTransform(openAiModel, "sess-1")).toBeUndefined();
  });

  test("stays out of the way while no session id is available", () => {
    expect(buildHeaderTransform(openCodeGoModel, undefined)).toBeUndefined();
  });

  test("keeps a caller supplied header instead of sending a duplicate", () => {
    const transform = buildHeaderTransform(openCodeGoModel, "sess-1");

    expect(transform?.({ "X-Opencode-Session": "caller" })).toEqual({
      "X-Opencode-Session": "caller",
      "x-opencode-client": "pi",
    });
  });
});

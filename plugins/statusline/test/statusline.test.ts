import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatContextUsage, layoutStatusline, type StatuslineFields } from "../src/index.ts";

const fields: StatuslineFields = {
  directory: "dir",
  branch: "branch",
  model: "model",
  thinking: "think",
  context: "ctx",
  statuses: ["one", "two"],
};

describe("formatContextUsage", () => {
  test("formats token counts in thousands", () => {
    expect(formatContextUsage({ tokens: 42_000, contextWindow: 128_000, percent: 32.8 })).toBe("42k/128k (33%)");
    expect(formatContextUsage({ tokens: 1_500, contextWindow: 8_000, percent: 18.75 })).toBe("1.5k/8k (19%)");
  });

  test("hides unavailable usage", () => {
    expect(formatContextUsage(undefined)).toBeUndefined();
    expect(formatContextUsage({ tokens: 0, contextWindow: 0, percent: 0 })).toBeUndefined();
    expect(formatContextUsage({ tokens: 1_000, contextWindow: 8_000, percent: null })).toBeUndefined();
  });
});

describe("layoutStatusline", () => {
  test("keeps all fields when they fit", () => {
    expect(layoutStatusline(fields, 80)).toBe("dir  branch  model  think  ctx  one  two");
  });

  test("drops optional fields in priority order", () => {
    expect(layoutStatusline(fields, 35)).toBe("dir  branch  model  think  ctx  one");
    expect(layoutStatusline(fields, 30)).toBe("dir  branch  model  think  ctx");
    expect(layoutStatusline(fields, 22)).toBe("dir  model  think  ctx");
    expect(layoutStatusline(fields, 15)).toBe("dir  model  ctx");
    expect(layoutStatusline(fields, 10)).toBe("dir  ctx");
  });

  test("truncates the directory before the context", () => {
    const line = layoutStatusline({ directory: "very-long-directory", context: "42k/128k", statuses: [] }, 15);
    expect(line).toEndWith("  42k/128k");
    expect(visibleWidth(line)).toBeLessThanOrEqual(15);
  });
});

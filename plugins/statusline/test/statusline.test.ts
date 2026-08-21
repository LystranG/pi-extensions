import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  contextProgressIcon,
  contextUsageColor,
  formatContextUsage,
  formatGitChanges,
  layoutStatusline,
  layoutStatuslineLines,
  normalizeExtensionStatus,
  parseGitStatusPorcelain,
  type StatuslineFields,
} from "../src/index.ts";

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

describe("context progress", () => {
  test("uses progressively filled circle icons", () => {
    expect(contextProgressIcon(0)).toBe("○");
    expect(contextProgressIcon(25)).toBe("◔");
    expect(contextProgressIcon(50)).toBe("◑");
    expect(contextProgressIcon(75)).toBe("◕");
    expect(contextProgressIcon(100)).toBe("●");
  });

  test("uses error color only above 80 percent", () => {
    expect(contextUsageColor(80)).toBe("muted");
    expect(contextUsageColor(80.1)).toBe("error");
  });
});

describe("git status", () => {
  test("formats Git counts as one compact field", () => {
    expect(formatGitChanges({ untracked: 2, unstaged: 1, staged: 3 }, (_color, text) => text)).toBe("!2 !1 +3");
  });

  test("counts untracked, unstaged, and staged entries", () => {
    const output = ["?? new-file.ts ", " M changed.ts ", "D  staged-delete.ts ", "MM staged-and-changed.ts "].join(
      "\0",
    );

    expect(parseGitStatusPorcelain(output)).toEqual({ untracked: 1, unstaged: 2, staged: 2 });
  });
});

describe("extension status", () => {
  test("replaces only the pi-mcp-adapter status icon", () => {
    expect(normalizeExtensionStatus("mcp", "🔌 MCP: 3 servers")).toBe("󰒍 MCP: 3 servers");
    expect(normalizeExtensionStatus("mcp", "\u001b[31m🔌 MCP: 3 servers\u001b[39m")).toBe(
      "\u001b[31m󰒍 MCP: 3 servers\u001b[39m",
    );
    expect(normalizeExtensionStatus("other", "🔌 MCP: unrelated")).toBe("🔌 MCP: unrelated");
  });
});

describe("layoutStatusline", () => {
  test("keeps all fields when they fit", () => {
    expect(layoutStatusline(fields, 80)).toBe("dir  branch  model  think  ctx  one  two");
  });

  test("includes a named session", () => {
    expect(layoutStatusline({ ...fields, session: "session" }, 100)).toBe(
      "dir  session  branch  model  think  ctx  one  two",
    );
  });
  test("moves secondary statuses to a second line", () => {
    expect(layoutStatuslineLines({ ...fields, secondaryStatuses: ["󰒍 MCP: 3"] }, 80)).toEqual([
      "dir  branch  model  think  ctx  one  two",
      "󰒍 MCP: 3",
    ]);
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

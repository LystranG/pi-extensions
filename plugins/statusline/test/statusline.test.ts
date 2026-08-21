import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  calculateSessionUsage,
  contextProgressIcon,
  contextUsageColor,
  formatContextUsage,
  formatCwdForStatusline,
  formatGitChanges,
  formatSessionUsage,
  formatTokenCount,
  groupExtensionStatuses,
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
  statuses: ["one", "two"],
};

describe("formatCwdForStatusline", () => {
  test("replaces only the home directory prefix", () => {
    expect(formatCwdForStatusline("/Users/test/programming/ai/pi-extensions", "/Users/test")).toBe(
      "~/programming/ai/pi-extensions",
    );
    expect(formatCwdForStatusline("/Users/tester/project", "/Users/test")).toBe("/Users/tester/project");
  });
});

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

describe("session usage", () => {
  test("formats token counts in K and M", () => {
    expect(formatTokenCount(1_500)).toBe("1.5K");
    expect(formatTokenCount(999_999)).toBe("1M");
    expect(formatTokenCount(1_000_000)).toBe("1M");
  });

  test("accumulates usage and calculates the latest cache hit rate", () => {
    const totals = calculateSessionUsage([
      {
        type: "message",
        message: { role: "assistant", usage: { input: 1_000, output: 200_000, cacheRead: 8_000, cacheWrite: 1_000 } },
      },
      {
        type: "message",
        message: { role: "toolResult", usage: { input: 100, output: 50_000, cacheRead: 0, cacheWrite: 0 } },
      },
      { type: "compaction", usage: { input: 500, output: 300_000, cacheRead: 0, cacheWrite: 0 } },
    ]);

    expect(totals).toEqual({
      input: 1_600,
      output: 550_000,
      cacheRead: 8_000,
      cacheWrite: 1_000,
      latestCacheHitRate: 80,
    });
    expect(formatSessionUsage(totals)).toBe("↓1.6K ↑550K W1K R8K CH80.0%");
  });

  test("shows zero cache statistics when token usage exists", () => {
    expect(formatSessionUsage({ input: 1_000, output: 200, cacheRead: 0, cacheWrite: 0, latestCacheHitRate: 0 })).toBe(
      "↓1K ↑0.2K W0K R0K CH0.0%",
    );
    expect(formatSessionUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
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
    expect(formatGitChanges({ untracked: 2, unstaged: 1, staged: 3 }, (_color, text) => text)).toBe("!2!1+3");
  });

  test("counts untracked, unstaged, and staged entries", () => {
    const output = ["?? new-file.ts ", " M changed.ts ", "D  staged-delete.ts ", "MM staged-and-changed.ts "].join(
      "\0",
    );

    expect(parseGitStatusPorcelain(output)).toEqual({ untracked: 1, unstaged: 2, staged: 2 });
  });
});

describe("extension status", () => {
  test("groups MCP before pi-lens LSP on the extension line", () => {
    expect(
      groupExtensionStatuses([
        ["pi-lens-lsp", "LSP Active: typescript"],
        ["other", "Other status"],
        ["mcp", "🔌 MCP: 3 servers enabled"],
      ]),
    ).toEqual({
      primary: ["Other status"],
      secondary: ["󰒍 MCP: 3 servers enabled", "LSP Active: typescript"],
    });
  });

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
    expect(layoutStatusline(fields, 80)).toBe("dir │ branch │ model │ think │ one │ two");
  });

  test("includes a named session", () => {
    expect(layoutStatusline({ ...fields, session: "session" }, 100)).toBe(
      "dir │ session │ branch │ model │ think │ one │ two",
    );
  });
  test("renders token usage separately from MCP and LSP statuses", () => {
    expect(
      layoutStatuslineLines(
        {
          ...fields,
          context: "ctx",
          sessionUsage: "↓159K ↑1.2K",
          secondaryStatuses: ["󰒍 MCP: 3", "LSP Active: typescript"],
        },
        80,
      ),
    ).toEqual(["dir │ branch │ model │ think │ one │ two", "ctx  ↓159K ↑1.2K", "󰒍 MCP: 3  LSP Active: typescript"]);
  });

  test("does not leave an empty token line", () => {
    expect(layoutStatuslineLines({ ...fields, context: undefined, secondaryStatuses: ["󰒍 MCP: 3"] }, 80)).toEqual([
      "dir │ branch │ model │ think │ one │ two",
      "󰒍 MCP: 3",
    ]);
  });

  test("drops optional fields in priority order", () => {
    expect(layoutStatusline(fields, 35)).toBe("dir │ branch │ model │ think │ one");
    expect(layoutStatusline(fields, 30)).toBe("dir │ branch │ model │ think");
    expect(layoutStatusline(fields, 22)).toBe("dir │ model │ think");
    expect(layoutStatusline(fields, 15)).toBe("dir │ model");
    expect(layoutStatusline(fields, 10)).toBe("dir");
  });

  test("truncates the full directory path", () => {
    const line = layoutStatusline({ directory: "very-long-directory", statuses: [] }, 15);
    expect(visibleWidth(line)).toBeLessThanOrEqual(15);
  });
});

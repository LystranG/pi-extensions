import { CustomEditor, copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const SEPARATOR = " · ";
const INPUT_PROMPT = "❯ ";
const SECONDARY_STATUS_KEYS = ["mcp", "pi-lens-lsp"] as const;
const ERROR_WIDGET_KEY = "statusline-error";

export interface ContextUsageValue {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface StatuslineFields {
  directory: string;
  topRight?: string | undefined;
  session?: string | undefined;
  branch?: string | undefined;
  model?: string | undefined;
  thinking?: string | undefined;
  context?: string | undefined;
  git?: string | undefined;
  statuses: string[];
  sessionUsage?: string | undefined;
  secondaryStatuses?: string[];
}

export interface GitChangeCounts {
  untracked: number;
  unstaged: number;
  staged: number;
}

export interface TokenUsageValue {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SessionUsageTotals extends TokenUsageValue {
  latestCacheHitRate?: number;
}

// 只接管 provider SSE JSON 解析日志，其他 stderr 错误仍保持原行为
export function formatProviderConsoleError(args: readonly unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first !== "string" || !first.startsWith("Could not parse message into JSON:")) return undefined;
  const detail = second === undefined ? "" : ` ${typeof second === "string" ? second : String(second)}`;
  return `${first}${detail}`.trim();
}

// 从 turn_end 的 assistant 消息中提取 Pi 已归一化的错误文本
export function formatTurnError(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (candidate.role !== "assistant" || candidate.stopReason !== "error") return undefined;
  if (typeof candidate.errorMessage !== "string") return "Error";
  return candidate.errorMessage.trim() || "Error";
}

// 将编辑器中的逻辑文本复制到系统剪贴板
export async function copyEditorText(
  text: string,
  copy: (value: string) => Promise<void> = copyToClipboard,
): Promise<boolean> {
  if (text.length === 0) return false;
  try {
    await copy(text);
    return true;
  } catch {
    return false;
  }
}

// 将本地日期时间格式化到分钟
export function formatStatuslineDateTime(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 为默认编辑器保留完整交互能力，只替换输入行左侧的提示符
class PromptEditor extends CustomEditor {
  private readonly prompt: string;

  constructor(
    tui: ConstructorParameters<typeof CustomEditor>[0],
    theme: ConstructorParameters<typeof CustomEditor>[1],
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    prompt: string,
  ) {
    super(tui, theme, keybindings);
    this.prompt = prompt;
  }

  override handleInput(data: string): void {
    if (matchesKey(data, "ctrl+shift+c")) {
      void copyEditorText(this.getExpandedText());
      return;
    }
    super.handleInput(data);
  }

  override render(width: number): string[] {
    const promptWidth = visibleWidth(INPUT_PROMPT);
    if (width <= promptWidth) return super.render(width);

    const lines = super.render(width - promptWidth);
    return lines.map((line, index) => {
      if (index === 1) return `${this.prompt}${line}`;
      if (index === 0 || line.includes("─")) return `${line}${"─".repeat(promptWidth)}`;
      return `${" ".repeat(promptWidth)}${line}`;
    });
  }
}

export function formatCwdForStatusline(cwd: string, home = process.env.HOME): string {
  if (!home) return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatThousands(value: number): string {
  const thousands = Math.max(0, value) / 1000;
  const precision = thousands < 10 && !Number.isInteger(thousands) ? 1 : 0;
  return `${thousands.toFixed(precision)}k`;
}

export function formatContextUsage(usage: ContextUsageValue | undefined): string | undefined {
  if (!usage || usage.tokens === null || usage.contextWindow <= 0 || usage.percent === null) return undefined;
  return `${formatThousands(usage.tokens)}/${formatThousands(usage.contextWindow)} ${Math.round(usage.percent)}%`;
}

// 使用圆形阶段图标表达上下文进度
export function contextProgressIcon(percent: number): string {
  if (percent >= 100) return "●";
  if (percent >= 75) return "◕";
  if (percent >= 50) return "◑";
  if (percent >= 25) return "◔";
  return "○";
}

export function contextUsageColor(percent: number): "error" | "muted" {
  return percent > 80 ? "error" : "muted";
}

export function parseGitStatusPorcelain(output: string): GitChangeCounts {
  const changes: GitChangeCounts = { untracked: 0, unstaged: 0, staged: 0 };
  for (const entry of output.split("\0")) {
    if (entry.length < 3 || entry[2] !== " ") continue;
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    if (indexStatus === "?" && worktreeStatus === "?") {
      changes.untracked++;
      continue;
    }
    if (indexStatus !== " ") changes.staged++;
    if (worktreeStatus !== " ") changes.unstaged++;
  }
  return changes;
}

export function formatTokenCount(value: number): string {
  const absoluteValue = Math.max(0, value);
  if (absoluteValue >= 1_000_000) {
    const millions = absoluteValue / 1_000_000;
    const precision = millions < 10 && !Number.isInteger(millions) ? 1 : 0;
    return `${millions.toFixed(precision).replace(/\.0$/, "")}M`;
  }
  const thousands = absoluteValue / 1_000;
  if (Math.round(thousands) >= 1_000) return `${(absoluteValue / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  const precision = thousands < 10 && !Number.isInteger(thousands) ? 1 : 0;
  return `${thousands.toFixed(precision).replace(/\.0$/, "")}K`;
}

// 缓存统计在一千 token 以下保留原始数量，避免非零值显示成零
function formatCacheTokenCount(value: number): string {
  const absoluteValue = Math.max(0, value);
  return absoluteValue > 0 && absoluteValue < 1_000 ? absoluteValue.toString() : formatTokenCount(absoluteValue);
}

export function calculateSessionUsage(
  entries: ReadonlyArray<{
    type: string;
    message?: { role: string; usage?: TokenUsageValue };
    usage?: TokenUsageValue;
  }>,
): SessionUsageTotals {
  const totals: SessionUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const entry of entries) {
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    if (!usage) continue;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
      if (promptTokens > 0) {
        totals.latestCacheHitRate = (usage.cacheRead / promptTokens) * 100;
      } else {
        totals.latestCacheHitRate = 0;
      }
    }
  }
  return totals;
}

export function formatSessionUsage(totals: SessionUsageTotals): string | undefined {
  const parts: string[] = [];
  if (totals.input > 0) parts.push(`↓${formatTokenCount(totals.input)}`);
  if (totals.output > 0) parts.push(`↑${formatTokenCount(totals.output)}`);
  if (parts.length > 0) {
    parts.push(`W${formatCacheTokenCount(totals.cacheWrite)}`);
    parts.push(`R${formatCacheTokenCount(totals.cacheRead)}`);
    if (totals.latestCacheHitRate !== undefined) {
      parts.push(`󰆼${totals.latestCacheHitRate.toFixed(1)}%`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function joinFields(fields: string[]): string {
  return fields.filter(Boolean).join(SEPARATOR);
}

function fits(value: string, width: number): boolean {
  return visibleWidth(value) <= width;
}

export function layoutStatusline(fields: StatuslineFields, width: number): string {
  if (width <= 0) return "";

  const statuses = [...fields.statuses];
  const render = (session = fields.session, branch = fields.branch, thinking = fields.thinking, model = fields.model) =>
    joinFields([
      fields.directory,
      session ?? "",
      branch ?? "",
      fields.git ?? "",
      model ?? "",
      thinking ?? "",
      ...statuses,
    ]);

  let candidate = render();
  while (!fits(candidate, width) && statuses.length > 0) {
    statuses.pop();
    candidate = render();
  }
  if (fits(candidate, width)) return candidate;

  candidate = render("", fields.branch, fields.thinking, fields.model);
  if (fits(candidate, width)) return candidate;

  candidate = render("", "", fields.thinking, fields.model);
  if (fits(candidate, width)) return candidate;

  candidate = render("", "", "", fields.model);
  if (fits(candidate, width)) return candidate;

  candidate = render("", "", "", "");
  if (fits(candidate, width)) return candidate;

  return truncateToWidth(fields.directory, width);
}

export function layoutStatuslineLines(
  fields: StatuslineFields,
  width: number,
  colorizeBorder: (text: string) => string = (text) => text,
): string[] {
  if (width <= 0) return [""];

  const contentWidth = Math.max(0, width - 3);
  const topRightWidth = visibleWidth(fields.topRight ?? "");
  const showTopRight = topRightWidth > 0 && contentWidth >= topRightWidth + 12;
  const primaryContentWidth = showTopRight ? contentWidth - topRightWidth - 3 : contentWidth;
  const lines = [layoutStatusline(fields, primaryContentWidth)];
  if (fields.context || fields.sessionUsage) {
    lines.push(truncateToWidth(joinFields([fields.context ?? "", fields.sessionUsage ?? ""]), contentWidth));
  }
  if (fields.secondaryStatuses && fields.secondaryStatuses.length > 0) {
    lines.push(truncateToWidth(joinFields(fields.secondaryStatuses), contentWidth));
  }
  return frameStatuslineLines(lines, width, colorizeBorder, showTopRight ? fields.topRight : undefined);
}

// 将多行状态内容嵌入与终端等宽的圆角边框
export function frameStatuslineLines(
  lines: string[],
  width: number,
  colorizeBorder: (text: string) => string = (text) => text,
  topRight?: string,
): string[] {
  if (width <= 0) return [""];
  if (width < 4) return lines.map((line) => truncateToWidth(line, width, ""));

  const contentWidth = width - 3;
  return lines.map((line, index) => {
    const content = truncateToWidth(line, contentWidth, "");
    const remainingWidth = Math.max(0, contentWidth - visibleWidth(content));
    const isFirst = index === 0;
    const isLast = index === lines.length - 1;

    if (isFirst || isLast) {
      const left = isFirst ? "╭" : "╰";
      const right = isFirst ? "╮" : "╯";
      if (isFirst && topRight) {
        const rightText = truncateToWidth(topRight, Math.max(0, remainingWidth - 2), "");
        const rightWidth = visibleWidth(rightText);
        const fillWidth = Math.max(0, remainingWidth - rightWidth - 1);
        const fill = fillWidth > 1 ? ` ${"─".repeat(fillWidth - 2)} ` : " ".repeat(fillWidth);
        return `${colorizeBorder(left)} ${content}${colorizeBorder(fill)}${rightText} ${colorizeBorder(right)}`;
      }

      const fill = remainingWidth > 0 ? ` ${"─".repeat(remainingWidth - 1)}` : "";
      return `${colorizeBorder(left)} ${content}${colorizeBorder(`${fill}${right}`)}`;
    }

    return `${colorizeBorder("│")} ${content}${" ".repeat(remainingWidth)}${colorizeBorder("│")}`;
  });
}

export function normalizeExtensionStatus(key: string, value: string): string {
  const status = value.replaceAll(/\s+/g, " ").trim();
  return key === "mcp" ? status.replace(/(?:🔌 )?MCP:/, "󰒍 MCP:") : status;
}

export function groupExtensionStatuses(entries: ReadonlyArray<readonly [string, string]>): {
  primary: string[];
  secondary: string[];
} {
  const secondaryKeys = new Set<string>(SECONDARY_STATUS_KEYS);
  const primary = entries
    // 未知 key 仍然保留在主状态行，避免第三方改名后状态消失
    .filter(([key]) => !secondaryKeys.has(key))
    .map(([key, value]) => normalizeExtensionStatus(key, value))
    .filter(Boolean);
  const secondary = SECONDARY_STATUS_KEYS.flatMap((statusKey) => {
    const entry = entries.find(([key]) => key === statusKey);
    return entry ? [normalizeExtensionStatus(entry[0], entry[1])] : [];
  });
  return { primary, secondary };
}

export function formatGitChanges(
  changes: GitChangeCounts,
  colorize: (color: "accent" | "warning", text: string) => string,
): string | undefined {
  const statuses: string[] = [];
  if (changes.untracked > 0) statuses.push(colorize("accent", `!${changes.untracked}`));
  if (changes.unstaged > 0) statuses.push(colorize("warning", `!${changes.unstaged}`));
  if (changes.staged > 0) statuses.push(colorize("warning", `+${changes.staged}`));
  return statuses.length > 0 ? statuses.join(" ") : undefined;
}

export default function statuslineExtension(pi: ExtensionAPI): void {
  let requestRender: (() => void) | undefined;
  let refreshGitStatus: (() => void) | undefined;
  let clockRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreConsoleError: (() => void) | undefined;
  let gitChanges: GitChangeCounts = { untracked: 0, unstaged: 0, staged: 0 };
  let gitRefreshId = 0;
  const refresh = () => requestRender?.();
  // 对齐到下一分钟刷新，避免状态栏时间长期停留在旧值
  const scheduleClockRefresh = () => {
    if (clockRefreshTimer) clearTimeout(clockRefreshTimer);
    const delay = 60_000 - (Date.now() % 60_000) + 25;
    clockRefreshTimer = setTimeout(() => {
      refresh();
      scheduleClockRefresh();
    }, delay);
  };
  const updateGitStatus = async (cwd: string): Promise<void> => {
    const refreshId = ++gitRefreshId;
    try {
      const result = await pi.exec(
        "git",
        ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
        {
          cwd,
          timeout: 1_000,
        },
      );
      if (refreshId !== gitRefreshId) return;
      gitChanges =
        result.code === 0 ? parseGitStatusPorcelain(result.stdout) : { untracked: 0, unstaged: 0, staged: 0 };
    } catch {
      if (refreshId !== gitRefreshId) return;
      gitChanges = { untracked: 0, unstaged: 0, staged: 0 };
    }
    requestRender?.();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    // 自定义 footer 统一处理 Git、上下文和扩展状态
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const prompt = ctx.ui.theme.fg("accent", INPUT_PROMPT);
      return new PromptEditor(tui, theme, keybindings, prompt);
    });
    const originalConsoleError = console.error;
    const capturedConsoleError = (...args: unknown[]) => {
      const error = formatProviderConsoleError(args);
      if (!error) {
        originalConsoleError.apply(console, args);
        return;
      }
      ctx.ui.setWidget(ERROR_WIDGET_KEY, (_tui, theme) => new Text(theme.fg("error", `Error: ${error}`), 0, 0), {
        placement: "aboveEditor",
      });
    };
    console.error = capturedConsoleError;
    restoreConsoleError = () => {
      if (console.error === capturedConsoleError) console.error = originalConsoleError;
    };
    scheduleClockRefresh();
    refreshGitStatus = () => void updateGitStatus(ctx.cwd);
    gitChanges = { untracked: 0, unstaged: 0, staged: 0 };
    void updateGitStatus(ctx.cwd);
    ctx.ui.setFooter((tui, theme, footerData) => {
      const renderFooter = () => tui.requestRender();
      requestRender = renderFooter;
      const unsubscribeBranch = footerData.onBranchChange(renderFooter);

      return {
        dispose() {
          unsubscribeBranch();
          if (requestRender === renderFooter) requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const contextUsage = ctx.getContextUsage();
          const usage = formatContextUsage(contextUsage);
          const branch = footerData.getGitBranch();
          const sessionName = ctx.sessionManager.getSessionName();
          const directory = formatCwdForStatusline(ctx.cwd);
          const contextStatus =
            usage && contextUsage?.percent !== null && contextUsage?.percent !== undefined
              ? theme.fg(
                  contextUsageColor(contextUsage.percent),
                  `${contextProgressIcon(contextUsage.percent)} ${usage}`,
                )
              : undefined;
          const sessionUsage = formatSessionUsage(calculateSessionUsage(ctx.sessionManager.getEntries()));
          const extensionStatuses = [...footerData.getExtensionStatuses().entries()];
          const groupedStatuses = groupExtensionStatuses(extensionStatuses);
          const secondaryStatuses = groupedStatuses.secondary;

          const fields: StatuslineFields = {
            directory: theme.fg("accent", `󰉋 ${directory}`),
            topRight: theme.fg("muted", `󰃭 ${formatStatuslineDateTime(new Date())}`),
            session: sessionName ? theme.fg("muted", `◈ ${sessionName}`) : undefined,
            branch: branch ? theme.fg("success", ` ${branch}`) : undefined,
            git: formatGitChanges(gitChanges, (color, text) => theme.fg(color, text)),
            model: ctx.model ? theme.fg("muted", `󰚩 ${ctx.model.provider}/${ctx.model.id}`) : undefined,
            thinking: ctx.thinkingLevel ? theme.fg("muted", `󰗆 ${ctx.thinkingLevel}`) : undefined,
            context: contextStatus ? theme.fg("muted", `󰍛 ${contextStatus}`) : undefined,
            statuses: groupedStatuses.primary,
            sessionUsage: sessionUsage ? theme.fg("muted", sessionUsage) : undefined,
            secondaryStatuses,
          };

          return layoutStatuslineLines(fields, width, (text) => theme.fg("borderMuted", text));
        },
      };
    });
  });

  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("session_info_changed", refresh);
  pi.on("turn_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(ERROR_WIDGET_KEY, undefined, { placement: "aboveEditor" });
  });
  pi.on("turn_end", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const error = formatTurnError(event.message);
    if (!error) return;
    ctx.ui.setWidget(ERROR_WIDGET_KEY, (_tui, theme) => new Text(theme.fg("error", `Error: ${error}`), 0, 0), {
      placement: "aboveEditor",
    });
  });
  pi.on("message_end", () => {
    refreshGitStatus?.();
    refresh();
  });
  pi.on("tool_result", () => {
    refreshGitStatus?.();
    refresh();
  });
  pi.on("session_compact", refresh);
  pi.on("session_shutdown", () => {
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    gitRefreshId++;
    if (clockRefreshTimer) clearTimeout(clockRefreshTimer);
    clockRefreshTimer = undefined;
    refreshGitStatus = undefined;
    requestRender = undefined;
  });
}

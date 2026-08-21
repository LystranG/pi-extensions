import { basename, parse } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const SEPARATOR = "  ";

export interface ContextUsageValue {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface StatuslineFields {
  directory: string;
  branch?: string | undefined;
  model?: string | undefined;
  thinking?: string | undefined;
  context?: string | undefined;
  statuses: string[];
}

function formatThousands(value: number): string {
  const thousands = Math.max(0, value) / 1000;
  const precision = thousands < 10 && !Number.isInteger(thousands) ? 1 : 0;
  return `${thousands.toFixed(precision)}k`;
}

export function formatContextUsage(usage: ContextUsageValue | undefined): string | undefined {
  if (!usage || usage.tokens === null || usage.contextWindow <= 0 || usage.percent === null) return undefined;
  return `${formatThousands(usage.tokens)}/${formatThousands(usage.contextWindow)} (${Math.round(usage.percent)}%)`;
}

function joinFields(fields: string[]): string {
  return fields.filter(Boolean).join(SEPARATOR);
}

function fits(value: string, width: number): boolean {
  return visibleWidth(value) <= width;
}

function fitCore(directory: string, context: string | undefined, width: number): string {
  if (width <= 0) return "";
  if (!context) return truncateToWidth(directory, width);
  if (visibleWidth(context) >= width) return truncateToWidth(context, width);

  const directoryWidth = width - visibleWidth(context) - visibleWidth(SEPARATOR);
  if (directoryWidth <= 0) return truncateToWidth(context, width);
  return `${truncateToWidth(directory, directoryWidth)}${SEPARATOR}${context}`;
}

export function layoutStatusline(fields: StatuslineFields, width: number): string {
  if (width <= 0) return "";

  const statuses = [...fields.statuses];
  const render = (branch = fields.branch, thinking = fields.thinking, model = fields.model) =>
    joinFields([fields.directory, branch ?? "", model ?? "", thinking ?? "", fields.context ?? "", ...statuses]);

  let candidate = render();
  while (!fits(candidate, width) && statuses.length > 0) {
    statuses.pop();
    candidate = render();
  }
  if (fits(candidate, width)) return candidate;

  candidate = render("", fields.thinking, fields.model);
  if (fits(candidate, width)) return candidate;

  candidate = render("", "", fields.model);
  if (fits(candidate, width)) return candidate;

  candidate = render("", "", "");
  if (fits(candidate, width)) return candidate;

  return fitCore(fields.directory, fields.context, width);
}

function normalizeStatus(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export default function statuslineExtension(pi: ExtensionAPI): void {
  let requestRender: (() => void) | undefined;
  const refresh = () => requestRender?.();

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

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
          const usage = formatContextUsage(ctx.getContextUsage());
          const branch = footerData.getGitBranch();
          const directoryName = basename(ctx.cwd) || parse(ctx.cwd).root || ctx.cwd;
          const statuses = [...footerData.getExtensionStatuses().values()].map(normalizeStatus).filter(Boolean);

          const fields: StatuslineFields = {
            directory: theme.fg("accent", `◫ ${directoryName}`),
            branch: branch ? theme.fg("muted", ` ${branch}`) : undefined,
            model: ctx.model ? theme.fg("muted", `◆ ${ctx.model.provider}/${ctx.model.id}`) : undefined,
            thinking: ctx.thinkingLevel ? theme.fg("muted", `◉ ${ctx.thinkingLevel}`) : undefined,
            context: usage ? theme.fg("muted", `◔ ${usage}`) : undefined,
            statuses,
          };

          return [layoutStatusline(fields, width)];
        },
      };
    });
  });

  pi.on("model_select", refresh);
  pi.on("thinking_level_select", refresh);
  pi.on("message_end", refresh);
  pi.on("session_compact", refresh);
  pi.on("session_shutdown", () => {
    requestRender = undefined;
  });
}

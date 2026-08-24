// 将 Pi 和 FFF 的搜索工具归一化为 Serena 能识别的 grep 调用

export interface SerenaRemindToolCall {
  toolName: "grep";
  toolInput: Record<string, unknown>;
}

const SERENA_GREP_TOOL_NAMES = new Set(["grep", "ffgrep", "multi_grep", "fff-multi-grep"]);
const SHELL_GREP_COMMAND_NAMES = new Set(["ack", "ag", "egrep", "fgrep", "grep", "rg"]);

function shellCommandName(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  const firstToken = command.trim().split(/\s+/, 1)[0];
  if (!firstToken) return undefined;
  return firstToken
    .replaceAll(/^['"]|['"]$/g, "")
    .split("/")
    .pop()
    ?.toLowerCase();
}

function isShellGrepCommand(toolInput: Record<string, unknown>): boolean {
  return SHELL_GREP_COMMAND_NAMES.has(shellCommandName(toolInput.command ?? toolInput.cmd) ?? "");
}

export function normalizeSerenaRemindToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): SerenaRemindToolCall | undefined {
  if (SERENA_GREP_TOOL_NAMES.has(toolName)) {
    return { toolName: "grep", toolInput };
  }
  if (toolName === "bash" && isShellGrepCommand(toolInput)) {
    return { toolName: "grep", toolInput };
  }
  return undefined;
}

export function shouldRunSerenaRemind(toolName: string, toolInput: Record<string, unknown> = {}): boolean {
  return normalizeSerenaRemindToolCall(toolName, toolInput) !== undefined;
}

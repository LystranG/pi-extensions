/** 可交给 dcg 检查的工具请求 */
export type ToolRequest = { kind: "command"; command: string } | { kind: "stdin"; input: string } | { kind: "ignore" };

/** 提取 Pi 工具中的 shell 命令或 PTY 输入 */
export function extractToolRequest(toolName: string, input: Record<string, unknown>): ToolRequest {
  if (toolName === "bash") {
    return typeof input.command === "string" && input.command.trim()
      ? { kind: "command", command: input.command.trim() }
      : { kind: "ignore" };
  }
  if (toolName === "exec_command") {
    return typeof input.cmd === "string" && input.cmd.trim()
      ? { kind: "command", command: input.cmd.trim() }
      : { kind: "ignore" };
  }
  if (toolName === "write_stdin") {
    return typeof input.chars === "string" ? { kind: "stdin", input: input.chars } : { kind: "ignore" };
  }
  return { kind: "ignore" };
}

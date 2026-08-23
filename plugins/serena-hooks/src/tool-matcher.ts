// 集中维护需要交给 Serena remind 检查的 Pi 工具名

const SERENA_REMIND_TOOL_NAMES = new Set(["bash", "grep", "ffgrep", "multi_grep", "fff-multi-grep"]);

export function shouldRunSerenaRemind(toolName: string): boolean {
  return SERENA_REMIND_TOOL_NAMES.has(toolName);
}

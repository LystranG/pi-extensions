// 修正 Serena SessionStart hook 中已失效的项目激活指令

/**
 * Serena 1.7.0 的 `serena-hooks activate` 会硬编码一条提示，要求 agent 调用
 * `activate_project` 工具。但当 Serena MCP server 以 single_project 上下文启动并同时指定了
 * 项目时（例如 `--context=ide --project-from-cwd`），项目已在启动阶段自动激活，Serena 会把
 * `activate_project` 从工具列表中移除，照做必然失败并可能让模型反复寻找不存在的工具
 */
const STALE_ACTIVATION_INSTRUCTION = "activate it using Serena's activate_project tool unless already done.";

/** 把上述指令改写为按工具是否存在自行判断，两个上下文下都成立 */
const ADAPTIVE_ACTIVATION_INSTRUCTION =
  "if Serena's `activate_project` tool is available, activate it unless already done.";

/**
 * 把激活提示里失效的那一句改写为自适应措辞，其余内容原样透传
 *
 * 只替换这一句而不是整段文案，是为了在上游修正文案后自然退化为直通：届时模式不再命中，
 * Serena 新增或调整的其他提示也能完整保留。needle 是纯文本，不涉及正则转义。
 */
export function adaptActivateContext(additionalContext: string): string {
  return additionalContext.replace(STALE_ACTIVATION_INSTRUCTION, ADAPTIVE_ACTIVATION_INSTRUCTION);
}

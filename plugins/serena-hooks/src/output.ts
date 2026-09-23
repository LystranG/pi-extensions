// 解析 Serena hook 返回的权限决定与上下文提示，并组装拦截工具调用时给模型看的原因文本

export interface SerenaHookOutput {
  decision?: "deny" | "allow" | undefined;
  reason?: string | undefined;
  additionalContext?: string | undefined;
}

export function parseSerenaHookOutput(stdout: string | undefined): SerenaHookOutput | undefined {
  const text = stdout?.trim();
  if (!text) return undefined;

  try {
    const value = JSON.parse(text) as {
      decision?: "deny" | "allow";
      reason?: string;
      hookSpecificOutput?: {
        permissionDecision?: "deny" | "allow";
        permissionDecisionReason?: string;
        additionalContext?: string;
      };
    };
    const hookOutput = value.hookSpecificOutput;
    return {
      decision: value.decision ?? hookOutput?.permissionDecision,
      reason: value.reason ?? hookOutput?.permissionDecisionReason,
      additionalContext: hookOutput?.additionalContext,
    };
  } catch {
    return undefined;
  }
}

// 组装拦截工具调用的原因文本，保证 Serena 的 additionalContext 提示也能随工具结果送达模型
export function formatDenyReason(output: SerenaHookOutput): string {
  const parts = [output.reason, output.additionalContext].filter((part): part is string => Boolean(part?.trim()));
  return parts.join("\n\n") || "Serena hook denied this tool call";
}

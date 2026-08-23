// 解析 Serena hook 返回的权限决定与上下文提示

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

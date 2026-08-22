import { spawn } from "node:child_process";
import type { CommandChecker, GuardConfig, GuardDecision } from "./types.ts";

/** 解析 dcg robot JSON 中可供用户理解的拒绝原因 */
function parseReason(stdout: string): string {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const reason = typeof record.reason === "string" ? record.reason : undefined;
      const ruleId = typeof record.rule_id === "string" ? record.rule_id : undefined;
      if (reason && ruleId) return `${reason} [${ruleId}]`;
      if (reason) return reason;
      if (ruleId) return `dcg 拒绝了此命令 [${ruleId}]`;
    }
  } catch {
    // dcg 的拒绝结果损坏时使用固定原因
  }
  return "dcg 判定此命令具有破坏性";
}

/** 通过 dcg robot API 判定一个命令 */
export function createDcgChecker(options: Pick<GuardConfig, "binary" | "timeoutMs">): CommandChecker {
  return (command) =>
    new Promise((resolve) => {
      let settled = false;
      let stdout = "";
      const child = spawn(options.binary, ["--robot", "test", command], { stdio: ["ignore", "pipe", "ignore"] });
      const finish = (decision: GuardDecision): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(decision);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ deny: true, reason: "dcg 判定超时，已阻止命令执行" });
      }, options.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < 16_384) stdout += chunk.toString();
      });
      child.on("error", () => finish({ deny: true, reason: "无法运行 dcg，已阻止命令执行" }));
      child.on("close", (code) => {
        if (code === 0) finish({ deny: false, reason: "" });
        else if (code === 1) finish({ deny: true, reason: parseReason(stdout) });
        else finish({ deny: true, reason: `dcg 返回错误（退出码 ${code ?? "未知"}），已阻止命令执行` });
      });
    });
}

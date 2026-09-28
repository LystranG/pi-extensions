/** 读取会话历史并构造独立标题请求的文本快照 */
import { buildSessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { MAX_CONVERSATION_SOURCE_LENGTH, stripSkillInstructions } from "./title.ts";

/** 每段先限长，避免单段日志或摘要挤掉任务起点和后续进展 */
const MAX_SECTION_LENGTH = 3000;
/** 截断位置明确标记，模型不能把缺失内容当作完整历史 */
const OMISSION_MARKER = "\n[... context omitted ...]\n";

/** 保留文本首尾，预算包含省略标记 */
function boundContext(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const headLength = Math.ceil((limit - OMISSION_MARKER.length) / 2);
  const tailLength = limit - OMISSION_MARKER.length - headLength;
  return text.slice(0, headLength) + OMISSION_MARKER + text.slice(-tailLength);
}

/**
 * 统计会话里已经存在的用户消息条数
 * 用于区分全新会话与恢复、分叉出来的会话：后者在 session_start 时就已经带着历史
 */
export function countUserMessages(entries: readonly SessionEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "user") count++;
  }
  return count;
}

/** 重建当前分支的有效对话，保留压缩摘要与可见正文 */
export function buildRenameContext(entries: SessionEntry[], leafId: string | null): string | undefined {
  const messages = buildSessionContext(entries, leafId).messages;
  const sections: string[] = [];
  for (const message of messages) {
    if (message.role === "compactionSummary" || message.role === "branchSummary") {
      if (message.summary.trim())
        sections.push(`[summary]\n${boundContext(message.summary.trim(), MAX_SECTION_LENGTH)}`);
    } else if (message.role === "user" || message.role === "assistant") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      const visibleText = message.role === "user" ? stripSkillInstructions(text) : text.trim();
      if (visibleText) sections.push(`[${message.role}]\n${boundContext(visibleText, MAX_SECTION_LENGTH)}`);
    }
  }
  return sections.length ? boundContext(sections.join("\n\n"), MAX_CONVERSATION_SOURCE_LENGTH) : undefined;
}

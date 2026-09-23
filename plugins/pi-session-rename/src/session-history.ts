import type { SessionEntry } from "@earendil-works/pi-coding-agent";

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

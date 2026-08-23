/** Maven 工具的默认限制 */

/** Maven 工具默认的执行超时时间 */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** Maven 摘要允许的最大字节数 */
export const MAX_SUMMARY_BYTES = 8_192;

/** Maven 摘要允许的最大诊断数量 */
export const MAX_FINDINGS = 24;

/** Maven 单类错误允许的最大诊断数量 */
export const MAX_FINDINGS_PER_KIND = 6;

/** Maven 失败回退时保留的日志头行数 */
export const FALLBACK_HEAD_LINES = 20;

/** Maven 失败回退时保留的日志尾行数 */
export const FALLBACK_TAIL_LINES = 60;

/** Maven 日志的默认目录 */
export const DEFAULT_LOG_DIRECTORY = ".agent-logs/maven";

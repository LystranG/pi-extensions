// 导出可测试的 Serena hook 组件并提供 Pi 扩展入口

export { createSerenaHookExecutor, runSerenaCommand } from "./command.ts";
export { SerenaHooksController } from "./controller.ts";
export { createSerenaHooksExtension, default } from "./extension.ts";
export { formatDenyReason, parseSerenaHookOutput } from "./output.ts";
export { normalizeSerenaRemindToolCall, shouldRunSerenaRemind } from "./tool-matcher.ts";
export type {
  SerenaCommandExecutor,
  SerenaHookAction,
  SerenaHookExecutor,
  SerenaHookInput,
  SerenaHookResult,
  SerenaHookWarning,
} from "./types.ts";

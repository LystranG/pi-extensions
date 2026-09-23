import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ModelEndpoint } from "./index.ts";

/** opencode 系 provider 的 id，与 pi-coding-agent 主循环的判定保持一致 */
const OPENCODE_PROVIDERS = new Set(["opencode", "opencode-go"]);

/** opencode 的路由域名，必须精确匹配 hostname，避免 `opencode.ai.example.com` 之类的伪造域名 */
const OPENCODE_HOSTNAME = "opencode.ai";

/** opencode 要求每个请求携带的会话路由头，缺失时请求会被拒为 400 MissingSessionID */
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

/** opencode 用来识别调用方的客户端标识头 */
export const OPENCODE_CLIENT_HEADER = "x-opencode-client";

/** 与主循环一致的客户端标识值 */
export const OPENCODE_CLIENT_NAME = "pi";

/**
 * 判断模型是否由 opencode 提供
 * provider id 命中即成立；自定义 provider 只要挂在 opencode.ai 这个 host 上也算
 */
export function isOpenCodeModel(model: ModelEndpoint): boolean {
  if (OPENCODE_PROVIDERS.has(model.provider)) return true;
  try {
    return new URL(model.baseUrl).hostname === OPENCODE_HOSTNAME;
  } catch {
    return false;
  }
}

/**
 * 生成 opencode 的会话路由头
 * 没有 session id 时无法构造，返回 undefined 让调用方放弃注入
 */
export function openCodeSessionHeaders(sessionId: string | undefined): ProviderHeaders | undefined {
  if (!sessionId) return undefined;
  return {
    [OPENCODE_SESSION_HEADER]: sessionId,
    [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT_NAME,
  };
}

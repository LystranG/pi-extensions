import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import { isOpenCodeModel, openCodeSessionHeaders } from "./opencode.ts";

/** 适配器只关心模型的这两个字段 */
export type ModelEndpoint = Pick<Model<Api>, "provider" | "baseUrl">;

/**
 * provider 请求头适配器
 * 扩展自己发起的模型请求绕过了 Pi 主循环的请求头装配，provider 需要的私有头必须由适配器补齐
 */
export interface ProviderHeaderAdapter {
  /** 该适配器是否负责这个模型 */
  matches(model: ModelEndpoint): boolean;
  /** 生成要追加的请求头；缺少必要上下文时返回 undefined */
  headers(sessionId: string | undefined): ProviderHeaders | undefined;
}

/** 已注册的适配器；接入新的 provider 时只在这里追加一项 */
const ADAPTERS: readonly ProviderHeaderAdapter[] = [
  {
    matches: isOpenCodeModel,
    headers: openCodeSessionHeaders,
  },
];

/** 判断请求头里是否已经有某个头，忽略大小写：调用方自己提供的值优先，适配器只补缺失的头 */
function hasHeader(headers: ProviderHeaders, name: string): boolean {
  const expected = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

/**
 * 为扩展侧发起的模型请求构造 transformHeaders
 * 没有适配器需要追加请求头时返回 undefined，避免把扩展私有的会话标识发给无关 provider
 */
export function buildHeaderTransform(
  model: ModelEndpoint,
  sessionId: string | undefined,
): ((headers: ProviderHeaders) => ProviderHeaders) | undefined {
  const additions: ProviderHeaders = {};
  for (const adapter of ADAPTERS) {
    if (!adapter.matches(model)) continue;
    Object.assign(additions, adapter.headers(sessionId));
  }
  if (Object.keys(additions).length === 0) return undefined;

  return (headers) => {
    const merged: ProviderHeaders = { ...headers };
    for (const [name, value] of Object.entries(additions)) {
      if (!hasHeader(merged, name)) merged[name] = value;
    }
    return merged;
  };
}

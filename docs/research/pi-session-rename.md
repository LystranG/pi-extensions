# Pi Session Rename Research

> **2026-09-24 更新**：本文 §Title Length Policy 里的「at most 10 Han characters and at most 5 non-Han words」已被
> [ADR 0002](../adr/0002-session-title-policy.md) 取代为「20 汉字 / 10 非汉字词」，长度超限重试也从 3 次降为 1 次。
> 提示词与校验口径的完整取舍见 [pi-session-rename-prompt.md](./pi-session-rename-prompt.md) 与 ADR 0002。

> **2026-09-23 更新**：本文 §Conclusion 中「让标题请求使用模型支持的最低 reasoning 等级」的假设已被证伪。
> `ctx.modelRegistry.complete()` 走的是非 simple 路径，`reasoning` 选项会被 pi-ai 忽略，`getTitleThinkingLevel()` 是死代码；
> 另外本文成稿时的 `@earendil-works/pi-ai@0.84.2` 并不具备 opencode 路由头逻辑。
> 完整诊断（含 issue #22 的 4 个缺陷、跨版本抓包证据与修复设计）见
> [pi-session-rename-issue-22-diagnosis.md](./pi-session-rename-issue-22-diagnosis.md)。

## Conclusion

The public Pi extension API supports the requested behavior with a small state
machine:

- Observe `input` and retain only the first ordinary prompt
- Observe the first final `turn_end` for the candidate prompt. `toolUse` means
  the assistant turn is continuing; `error` and `aborted` are held until
  `agent_settled` so an automatic retry can recover the same prompt
- Use `ctx.modelRegistry.complete()` with the current `ctx.model` to make an
  independent request using Pi's active model registry and provider
  configuration
- Persist the result with `pi.setSessionName()`
- Abort the independent request from `session_shutdown`

Pi does not expose a dedicated abort-reason field on the extension events.
The implementation therefore rejects streaming steering/follow-up input,
tracks `turn_end` stop reasons, and clears an exhausted failed candidate at
`agent_settled`. Session generation tokens also prevent a late title promise
from naming a replacement session.

## Primary Sources

- [Pi extension guide](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md):
  lifecycle events, input events, `agent_settled`, extension context, model
  registry, and session naming
- [Pi extension types](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/core/extensions/types.ts):
  exact `InputEvent`, `AgentSettledEvent`, `ExtensionContext`, and
  `SessionInfoChangedEvent` shapes
- [Pi AI compatibility API](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/compat.ts):
  `streamSimple(model, context, options)` and its result stream
- [Session-name event fix](https://github.com/badlogic/pi-mono/commit/c19e64a444373b558d5d0d44eb4d52877ea07593):
  session metadata updates and interactive title refresh

## Version Notes

This repository currently develops against `@earendil-works/pi-coding-agent`
and `@earendil-works/pi-ai` version `0.84.2`. Older Pi releases may not expose
`agent_settled`, `session_info_changed`, or immediate session-title refresh.

## Title Length Policy

The plugin validates the normalized model result without truncating it. It
counts Han characters separately from non-Han letter/number words and requires
both limits to pass: at most 10 Han characters and at most 5 non-Han words.
The initial generation is followed by at most 3 retries when the result is
oversized. Four oversized results total cause the plugin to leave the session
name unchanged and show an English warning.

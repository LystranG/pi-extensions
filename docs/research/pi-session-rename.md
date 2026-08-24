# Pi Session Rename Research

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

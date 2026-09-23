# @lystran/pi-session-rename

Automatically names a Pi session from the first user message of a new session. The title is generated in a separate, best-effort background model request using the model currently selected in Pi, so the main agent workflow is not modified.

The prompt is read from the expanded user turn, so a session whose first message is `/skill:<name> ...` or a prompt template is named from the text the user wrote themselves and not from the injected skill instructions. At most one title request is issued per session, and it starts from the first eligible user message: commands handled by Pi or by other extensions, `!`/`!!` shell input, extension-generated input, queued steering/follow-up input, and turns without an available model all leave the session eligible without consuming it. A session that already contains user messages when it loads — resumed with `pi -r` / `pi -c`, forked, or already named — is never renamed, and later turns, tool calls, compaction, or queued follow-up processing cannot overwrite the first prompt's title request.

Requests the extension issues itself bypass Pi's main-loop header assembly, so provider-specific headers are attached through an adapter under `src/adapters/`. The opencode adapter adds `x-opencode-session` and `x-opencode-client: pi` for models served by the `opencode` / `opencode-go` providers or hosted on `opencode.ai`; every other provider is left untouched.

Generated names must contain at most 10 Chinese characters and at most 5 non-Chinese words. An oversized result is rejected and regenerated up to 3 times. If all retries exceed the limit, the session keeps its existing name and Pi shows an English warning.

A reply that carries no usable title — for example a thinking-only reply truncated by the output budget on a model whose thinking cannot be turned off — is retried with the same prompt, up to 3 retries in total. If every attempt fails, Pi shows an English warning and the session keeps its existing name; provider errors are reported immediately. The background request is only cancelled when the session is closed or replaced, so a first turn that Pi interrupts can still end up naming the session.

## Install

```bash
pi install npm:@lystran/pi-session-rename
```

For local development:

```bash
pi install -l .
```

The extension requires Pi `>=0.84.2`.

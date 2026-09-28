# @lystran/pi-session-rename

Automatically names a Pi session from the first user message of a new session. The title is generated in a separate, best-effort background model request using the model currently selected in Pi, so the main agent workflow is not modified; the request opts out of prompt caching, so it cannot pollute the main conversation's cache.

The automatic title request carries its instructions as a system prompt and the user's first message as the only user message, so the constraints are never mixed into the text being named. The instructions require the title to be written in the language the user wrote in rather than in the language of the instructions, to start with an imperative verb immediately followed by the specific thing the user named — the component, file, function, error, or concept — and to keep code identifiers, paths, commands, and error codes exactly as written. A first message that is only a greeting is named by its tone instead.

The prompt is read from the expanded user turn, so a session started with `/skill:<name> ...` or a prompt template is named from the arguments the user passed to the command and not from the injected skill or template body; a command invoked without arguments falls back to its expanded body. Commands handled by Pi or by other extensions, `!`/`!!` shell input, extension-generated input, queued steering/follow-up input, and slash commands Pi passed through unexpanded are ignored. Automatic naming runs at most once per session, from the first user message that yields usable text, and every later message is ignored. A session that already contains user messages when it loads is never renamed — for example one resumed with `pi -r` / `pi -c`, or a fork that carries history. Later turns, tool calls, compaction, or queued follow-up processing cannot overwrite the first prompt's title request.

Requests the extension issues itself bypass Pi's main-loop header assembly, so provider-specific headers are attached through an adapter under `src/adapters/`. The opencode adapter adds `x-opencode-session` and `x-opencode-client: pi` for models served by the `opencode` / `opencode-go` providers or hosted on `opencode.ai`; every other provider is left untouched.

Generated names must contain at most 20 Chinese characters and at most 10 non-Chinese words. The two limits are counted separately and both must hold, so a pure-Chinese title is bounded by the character limit and a pure-English title by the word limit. An oversized result is rejected and regenerated once, with a retry prompt that reports only the limit that was exceeded and repeats the user's first message. If the replacement still exceeds the limit, the session keeps its existing name and Pi shows an English warning.

A reply that carries no usable title — for example a thinking-only reply truncated by the output budget on a model whose thinking cannot be turned off — is retried with the same prompt, up to 3 retries in total. If every attempt fails, Pi shows an English warning and the session keeps its existing name; provider errors are reported immediately. Interrupting the main agent does not cancel the background title request, so an interrupted first turn can still end up naming the session. Closing or replacing the session, navigating the session tree, or invoking `/auto-rename` cancels an older title request.

## Rename on demand

Run `/auto-rename` to generate a new name from the overall task in the current conversation branch. It uses the model currently selected in Pi and immediately takes a snapshot, even while the main agent is working. The snapshot includes compaction and branch summaries plus saved user and assistant text; unfinished streaming replies and queued input are not included. Skill instructions, thinking, tool calls, and raw tool output are excluded.

A successful result directly replaces the existing session name, including a name you set manually. Resumed and forked sessions are supported. Empty context, a missing model, or generation failure leaves the existing name unchanged and shows an English warning. Pi also shows when generation starts and when the name is updated.

Running `/auto-rename` again cancels the previous naming request, including an automatic first-message request, and only the newest request may update the name. Switching sessions, reloading, closing Pi, or navigating the session tree invalidates pending results. Ordinary conversation progress does not invalidate the snapshot.

Manual naming keeps the same language, specificity, formatting, length limits, and retry rules as automatic naming. Each source section is limited to 3,000 characters and the combined snapshot to 16,000 characters, preserving the beginning and end with explicit omission markers. Long conversations are therefore represented by a bounded excerpt rather than their complete history.

## Install

```bash
pi install npm:@lystran/pi-session-rename
```

For local development:

```bash
pi install -l .
```

The extension requires Pi `>=0.84.2`.

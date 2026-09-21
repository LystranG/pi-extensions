# @lystran/pi-session-rename

Automatically names a Pi session as soon as its first user turn starts. The title is generated in a separate, best-effort background model request using the model currently selected in Pi with the lowest reasoning level that model supports, so the main agent workflow is not modified.

The prompt is read from the expanded user turn, so a session whose first message is `/skill:<name> ...` or a prompt template is named from the text the user wrote themselves and not from the injected skill instructions. Commands handled by Pi or by other extensions, `!`/`!!` shell input, extension-generated input, queued steering/follow-up input, and sessions that already have a name are ignored. The request starts before the first assistant response, and later turns, tool calls, compaction, or queued follow-up processing cannot overwrite the first prompt's title request.

Generated names must contain at most 10 Chinese characters and at most 5 non-Chinese words. An oversized result is rejected and regenerated up to 3 times. If all retries exceed the limit, the session keeps its existing name and Pi shows an English warning.

If the background title request fails, Pi shows an English warning and the extension leaves the session unchanged. A first turn that Pi interrupts, or that exhausts its retries before any title was delivered, is discarded once the agent settles so a later user turn can still be named; a title that already landed is kept.

## Install

```bash
pi install npm:@lystran/pi-session-rename
```

For local development:

```bash
pi install -l .
```

The extension requires Pi `>=0.84.2`.

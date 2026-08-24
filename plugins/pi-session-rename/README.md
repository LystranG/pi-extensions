# @lystran/pi-session-rename

Automatically names a Pi session after the first ordinary user turn reaches its first final assistant response. The title is generated in a separate, best-effort model request using the model currently selected in Pi, so the main agent workflow is not modified.

Commands, `!`/`!!` shell input, extension-generated input, queued steering/follow-up input, interrupted turns, exhausted network-error turns, and sessions that already have a name are ignored. Automatic retry, tool-call turns, compaction, and queued follow-up processing cannot overwrite the first prompt's title request.

Generated names must contain at most 10 Chinese characters and at most 5 non-Chinese words. An oversized result is rejected and regenerated up to 3 times. If all retries exceed the limit, the session keeps its existing name and Pi shows an English warning.

## Install

```bash
pi install npm:@lystran/pi-session-rename
```

For local development:

```bash
pi install -l .
```

The extension requires Pi `>=0.84.2`.

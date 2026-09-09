# @lystran/pi-session-rename

Automatically names a Pi session as soon as its first ordinary user input is received. The title is generated in a separate, best-effort background model request using the model currently selected in Pi with the lowest reasoning level that model supports, so the main agent workflow is not modified.

Commands, `!`/`!!` shell input, extension-generated input, queued steering/follow-up input, and sessions that already have a name are ignored. The request starts before the first assistant response and later turns, tool calls, compaction, or queued follow-up processing cannot overwrite the first prompt's title request.

Generated names must contain at most 10 Chinese characters and at most 5 non-Chinese words. An oversized result is rejected and regenerated up to 3 times. If all retries exceed the limit, the session keeps its existing name and Pi shows an English warning.

If the background title request fails, Pi shows an English warning and the extension leaves the session unchanged. Interrupted or failed first turns are discarded after the agent settles, so a later ordinary turn can still be named.

## Install

```bash
pi install npm:@lystran/pi-session-rename
```

For local development:

```bash
pi install -l .
```

The extension requires Pi `>=0.84.2`.

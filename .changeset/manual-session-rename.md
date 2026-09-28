---
"@lystran/pi-session-rename": minor
---

Add `/auto-rename` to regenerate the session name from the overall task in the current conversation branch using the selected model.

- Include compaction and branch summaries in a bounded snapshot of saved conversation text, while preserving the existing language, formatting, length limits, and retry rules
- Run immediately while the main agent is working, and support resumed, forked, and already named sessions
- Replace the existing name only after successful generation; keep it unchanged when context or a model is unavailable, or generation fails
- Let the latest naming request win, cancel superseded requests, and discard stale results after session changes or tree navigation
- Preserve first-message automatic naming when `/auto-rename` is invoked before any conversation exists

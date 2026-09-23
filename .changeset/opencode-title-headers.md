---
"@lystran/pi-session-rename": patch
---

Send opencode's per-conversation routing headers (`x-opencode-session`, `x-opencode-client`) on the background title request, so sessions using the `opencode` / `opencode-go` providers are named instead of failing with `400 MissingSessionID` (Thanks @LiusCraft)

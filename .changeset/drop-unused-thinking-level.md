---
"@lystran/pi-session-rename": minor
---

Drop the unused `getTitleThinkingLevel()` export and stop sending a `reasoning` level with the background title request: `modelRegistry.complete()` runs the non-simple provider path, which ignores that option, so the level never reached the model

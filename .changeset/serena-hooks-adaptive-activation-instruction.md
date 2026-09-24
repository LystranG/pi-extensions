---
"@lystran/pi-serena-hooks": patch
---

Rewrite Serena's session-start instruction to call `activate_project` into a conditional form, because Serena removes that tool when it auto-activates a project in single-project mode

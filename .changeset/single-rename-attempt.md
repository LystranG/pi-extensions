---
"@lystran/pi-session-rename": patch
---

Limit automatic naming to the first user message of a new session, and never rename a session resumed with `pi -r` / `pi -c` or forked; the title request is no longer cancelled when the first turn is interrupted

---
"@lystran/pi-guard": minor
---

Deliver through the terminal bell inside tmux and GNU screen instead of spawning a system notification

Those multiplexers drop the `OSC 99`/`OSC 777` notifications, but a bell becomes a window alert in the status line and, unless `visual-bell` is on, is passed through to the outer terminal, which can raise a native notification that links back to the session. The bell was unreachable there before: it only ran when every system notification candidate failed, and `osascript` reports success with exit code 0 whether or not a banner appears. With `bell: false` the system notification chain is used instead

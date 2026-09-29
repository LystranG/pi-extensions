---
"@lystran/pi-guard": minor
---

Stop guarding subagent sessions: a session hosted by a `pi-subagents` background runner sets `PI_SUBAGENT_CHILD=1` before loading extensions, and Pi Guard now registers nothing there

Those sessions have no confirmation UI, so `headless: "deny"` made Pi Guard deny every command dcg classified as dangerous instead of confirming it, which interrupted unattended subagent work. Upgrading therefore also removes Pi Guard's protection inside subagents. A foreground child still loads it when an agent lists it explicitly in `extensions` or `subagentOnlyExtensions`

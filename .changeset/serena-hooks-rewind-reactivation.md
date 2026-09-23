---
"@lystran/pi-serena-hooks": minor
---

Fix Serena reactivation after rewinding the session tree, forward Serena's reminder context, and clean up hook data on session replacement

- Re-run `activate` when a `session_tree` navigation rewinds the branch to before the first user message, detected from the post-navigation branch instead of the never-null `newLeafId`
- Queue activation context with `deliverAs: "nextTurn"` so it is injected in the same turn as the next user message instead of one turn later
- Queue at most one rewind activation per upcoming user message so repeated navigation before sending does not stack duplicate context
- Include Serena's `additionalContext` in the blocked tool result so the reminder reaches the model
- Run `cleanup` on `quit`, `new`, `resume`, and `fork`, while skipping `reload` because it keeps the same session
- Remove the redundant resume-time reactivation that injected the activation context twice
- Export `createSerenaHooksExtension` and `formatDenyReason` so the lifecycle wiring and the deny-reason formatting can be tested and reused

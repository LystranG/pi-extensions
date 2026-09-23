# @lystran/pi-session-rename

## 0.3.0

### Minor Changes

- e9bb95e: Drop the unused `getTitleThinkingLevel()` export and stop sending a `reasoning` level with the background title request: `modelRegistry.complete()` runs the non-simple provider path, which ignores that option, so the level never reached the model

### Patch Changes

- 21e4d4d: Send opencode's per-conversation routing headers (`x-opencode-session`, `x-opencode-client`) on the background title request, so sessions using the `opencode` / `opencode-go` providers are named instead of failing with `400 MissingSessionID` (Thanks to @LiusCraft)
- 21e4d4d: Limit automatic naming to the first user message of a new session, and never rename a session resumed with `pi -r` / `pi -c` or forked; the title request is no longer cancelled when the first turn is interrupted
- 5cbd011: Name a session started with a prompt template or `/skill:<name>` from the arguments the user passed to the command instead of the expanded template or skill body, which Pi substitutes into the prompt before the extension sees it
- 21e4d4d: Give the background title request enough output budget for models whose thinking cannot be turned off, and retry a reply that carries no title before warning instead of leaving the session unnamed without feedback (Thanks to @LiusCraft)

## 0.2.3

### Patch Changes

- 35c35cd: Name a session from the user's own text after Pi expands `/skill:<name>` and prompt templates, and warn when the title provider returns an error instead of failing silently

## 0.2.2

### Patch Changes

- ddf2697: Start background session title generation on the first ordinary user input and use the lowest reasoning level supported by the selected model.

## 0.2.1

### Patch Changes

- ec5cadd: Report background title-generation failures and recover cleanly when a completed turn has no available model

## 0.2.0

### Minor Changes

- b974791: Add automatic session naming after the first completed ordinary user turn with
  bounded title length and retry handling

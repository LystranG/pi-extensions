# @lystran/pi-session-rename

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

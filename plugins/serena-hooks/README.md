# @lystran/pi-serena-hooks

Connects Serena lifecycle commands to a Pi coding agent. The plugin injects JSON stdin into Serena hooks and explicitly uses the `claude-code` client to match Pi's native tool events.

## Requirements

- Pi coding agent `>=0.84.2`
- Node.js `>=20`
- The `serena-hooks` executable is available on `PATH`

## Installation

```bash
pi install npm:@lystran/pi-serena-hooks
```

For local development:

```bash
cd plugins/serena-hooks
pi install -l .
```

## Lifecycle Mapping

| Pi event | Command |
| --- | --- |
| Any `session_start` | `serena-hooks activate --client claude-code` |
| Before a model `bash` call | `serena-hooks remind --client claude-code` |
| `session_shutdown` with reason `quit` | `serena-hooks cleanup --client claude-code` |

`remind` watches model-initiated `bash`, `grep`, `ffgrep`, `multi_grep`, and `fff-multi-grep` tools. This supports Pi's native search tools and FFF's `tools-and-ui`, `tools-only`, and `override` modes, while avoiding false blocks from Serena's repeated-read reminder when reading skills, source code, or documentation. `find` and `fffind` search paths and do not trigger `remind`. Each command waits for at most 10 seconds. Missing commands, timeouts, and non-zero exits do not block Pi; each action produces at most one warning per session, while later events continue to attempt the command.

Shell commands executed directly by the user with `!` or `!!` do not trigger `remind`.

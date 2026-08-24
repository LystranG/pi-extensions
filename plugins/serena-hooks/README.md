# @lystran/pi-serena-hooks

Connects Serena lifecycle commands to a Pi coding agent. The plugin injects JSON stdin into Serena hooks and uses Serena's `claude-code` hook format to match Pi's native tool events.

## Prerequisites

- Pi coding agent `>=0.84.2`
- Node.js `>=20`
- The Serena CLI is installed on the system
- Both `serena` and `serena-hooks` are available on `PATH`

Verify the CLI installation before starting Pi:

```bash
serena --version
serena-hooks --help
```

Install Serena using the method documented by the Serena project: https://oraios.github.io/serena/

This plugin does not provide the Serena MCP server or install the Serena CLI. The Serena MCP server must be configured separately in Pi, for example through `pi-mcp-adapter`, when symbolic Serena tools are required.

## Installation

```bash
pi install npm:@lystran/pi-serena-hooks
```

For local development:

```bash
cd plugins/serena-hooks
pi install -l .
```

## Integrated Plugins

### `@ff-labs/pi-fff`

The plugin supports all three FFF operating modes:

| FFF mode | Search tools handled by Serena |
| --- | --- |
| `tools-and-ui` | `ffgrep`, optional `fff-multi-grep` |
| `tools-only` | `ffgrep`, optional `fff-multi-grep` |
| `override` | `grep`, optional `multi_grep` |

FFF path-search tools, `fffind` and overridden `find`, are intentionally not sent to `remind`.

### `pi-mcp-adapter`

This is an optional companion plugin for exposing Serena's MCP tools to Pi. It is not intercepted by `remind`; configure the Serena MCP server and its direct tools through `pi-mcp-adapter` separately.

## Serena Hook Format

The plugin is compatible with the JSON hook protocol exposed by Serena's `--client claude-code` option. It sends `session_id`, `tool_name`, and `tool_input` through stdin, then handles Serena's `hookSpecificOutput` response:

- `additionalContext` is forwarded to the Pi agent
- `permissionDecision: "deny"` blocks the current matching tool call
- command failures, timeouts, and malformed output do not block Pi

Using the `claude-code` format does not require Claude Code and does not launch Claude Code. It only selects Serena's compatible hook input and output schema for this Pi adapter.

## Lifecycle Mapping

| Pi event | Command |
| --- | --- |
| Any `session_start` | `serena-hooks activate --client claude-code` |
| Before a model code-search call | `serena-hooks remind --client claude-code` |
| `session_shutdown` with reason `quit` | `serena-hooks cleanup --client claude-code` |

`remind` watches model-initiated `grep`, `ffgrep`, `multi_grep`, and `fff-multi-grep` tools, plus Bash calls whose command starts with `grep`, `rg`, `fgrep`, `egrep`, `ag`, or `ack`. These calls are normalized to Serena's `grep` semantics, supporting Pi's native search tools and FFF's `tools-and-ui`, `tools-only`, and `override` modes. Ordinary Bash, skill reads, source reads, and documentation reads do not trigger the reminder. `find` and `fffind` search paths and do not trigger `remind`. Each command waits for at most 10 seconds. Missing commands, timeouts, and non-zero exits do not block Pi; each action produces at most one warning per session, while later events continue to attempt the command.

Shell commands executed directly by the user with `!` or `!!` do not trigger `remind`.

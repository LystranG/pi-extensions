# @lystran/pi-guard

Checks commands with [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard)'s `dcg --robot test` interface before Pi executes the `bash` tool, with configurable confirmation or denial rules for specific commands

## Installation

Install dcg according to its official documentation and verify that `dcg --version` works, then run this from the plugin directory:

```bash
pi install -l .
```

You can also add the published package to Pi's extension configuration

## Configuration

The plugin denies commands that dcg considers dangerous by default. Rule files are searched in this order:

- Project configuration: `.pi/guard.json`
- User configuration: `~/.pi/agent/guard.json`
- `PI_GUARD_CONFIG`: Explicit configuration path

Example configuration:

```json
{
  "defaultMode": "deny",
  "headless": "deny",
  "rules": [
    { "command": "rm -rf *", "mode": "confirm" },
    { "command": "git reset --hard *", "mode": "confirm" },
    { "command": "git clean -fd *", "mode": "deny" }
  ]
}
```

Rules only override commands that dcg has already classified as dangerous; dcg continues to evaluate and execute ordinary safe commands. Rules are matched in file order, and the first match wins. In a command containing `*`, `*` matches any number of characters

You can also explicitly use `match: "exact"`, `"prefix"`, `"wildcard"`, or `"regex"`. When `match` is omitted, commands without `*` use exact matching and commands containing `*` use wildcard matching

Optional environment variables: `DCG_BIN`, `DCG_PI_MODE`, `DCG_PI_HEADLESS`, `DCG_PI_TIMEOUT_MS`

Commands are denied when dcg is missing, times out, returns malformed output, or exits with an unrecognized code. Pi displays a notification for direct denials, configuration errors, and canceled confirmations; confirmation dialogs show the command, dcg reason, and matching configuration rule

## Boundaries

This is pre-execution protection for Pi `bash` tool calls, not an operating-system sandbox. It does not cover other custom tools, shells started directly by the user, or scripts that bypass tool calls; use Pi inside a container or OS sandbox when stronger isolation is required

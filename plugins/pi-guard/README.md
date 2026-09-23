# @lystran/pi-guard

Checks commands with [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard)'s `dcg --robot test` interface before Pi executes the `bash` tool, with configurable confirmation or denial rules for specific commands

## Installation

Install dcg according to its official documentation and verify that `dcg --version` works, then run this from the plugin directory:

```bash
pi install -l .
```

You can also add the published package to Pi's extension configuration

## Integrated Plugins

- `@howaboua/pi-codex-conversion`

## Configuration

The plugin asks for confirmation when dcg considers a command dangerous by default. If no configuration exists, the plugin creates `~/.pi/agent/guard.json` with this policy. Existing configuration files are never overwritten. Rule files are searched in this order:

- Project configuration: `.pi/guard.json`
- User configuration: `~/.pi/agent/guard.json`
- `PI_GUARD_CONFIG`: Explicit configuration path

Example configuration:

```json
{
  "defaultMode": "confirm",
  "headless": "deny",
  "notify": { "includeCommand": false },
  "rules": [
    { "command": "rm -rf *", "mode": "deny" },
    { "command": "git clean -fd *", "mode": "deny" }
  ]
}
```

`defaultMode` controls dangerous commands that do not match a specific rule. It defaults to `confirm`, so a confirmation dialog is shown for every command that dcg classifies as dangerous. A matching rule overrides `defaultMode`, so use `mode: "deny"` for commands that must never be approved interactively

Rules only apply after dcg has classified a command as dangerous, except that a matching `mode: "confirm"` rule also asks about commands dcg considers safe. dcg continues to evaluate and execute ordinary safe commands. Rules are matched in file order, and the first match wins. In a command containing `*`, `*` matches any number of characters

You can also explicitly use `match: "exact"`, `"prefix"`, `"wildcard"`, or `"regex"`. When `match` is omitted, commands without `*` use exact matching and commands containing `*` use wildcard matching

Optional environment variables: `DCG_BIN`, `DCG_PI_MODE`, `DCG_PI_HEADLESS`, `DCG_PI_TIMEOUT_MS`, `DCG_PI_NOTIFY` (`on` or `off`)

Commands are denied when dcg is missing, times out, returns malformed output, or exits with an unrecognized code. Pi displays a notification for direct denials, configuration errors, and canceled confirmations; confirmation dialogs show the command, dcg reason, and matching configuration rule

## Notifications

The plugin delivers a notification right before a confirmation dialog appears, so a session that keeps running in a background terminal can still reach you. Notifications are sent in interactive TUI sessions on an interactive terminal only; print, JSON, and RPC modes are skipped, and a redirected stdout receives no terminal escape sequences. A notification is a best-effort side effect and never changes a guard decision

Delivery stops at the first layer that applies:

| Order | Layer | Applies when |
| --- | --- | --- |
| 1 | Terminal notification (`OSC 99` on kitty, `OSC 777` on the others) | The terminal is known to render it |
| 2 | System notification chain | Layer 1 does not apply |
| 3 | Terminal bell | Every candidate in layer 2 failed and `bell` is enabled |

A layer 1 hit skips the system notification chain, so one confirmation never raises two notifications. The price is that a terminal escape sequence reports no failure, so the terminal list is a positive allowlist and anything unrecognised falls through to layer 2:

- Renders `OSC 99` or `OSC 777`: kitty, Ghostty, WezTerm, iTerm2, Warp, rxvt-unicode
- Excluded: tmux and GNU screen drop these sequences instead of passing them through, Windows Terminal ships `OSC 777` disabled, and VS Code's xterm.js implements none of them; Apple Terminal and Alacritty are excluded for the same reason, and `TERM=dumb` declares no terminal capability at all
- tmux is excluded by `TMUX` and screen by `STY`, not by `TERM_PROGRAM`: tmux rewrites `TERM_PROGRAM` but leaves other terminal variables such as `KITTY_WINDOW_ID` in place, so only the multiplexer variables themselves are reliable

```json
{
  "notify": {
    "enabled": true,
    "includeCommand": false,
    "minIntervalMs": 1500,
    "maxPerMinute": 5,
    "bell": true
  }
}
```

- `enabled` sends notifications, `DCG_PI_NOTIFY=off` disables them for one run
- `includeCommand` appends the truncated command text to the notification body, which keeps that command in the notification center, so it is off by default. Notification text is stripped of control characters and semicolons before it reaches a terminal escape sequence, so command text cannot end that sequence early or inject another one
- `minIntervalMs` is the minimum delay between two notifications, and `maxPerMinute` caps a burst of confirmations; both apply to every layer
- `bell` writes a single terminal bell when no system notification was delivered on an interactive terminal

Notification commands are spawned as separate processes with an argument vector, never through a shell, and each failure falls back to the next candidate in the chain:

| Platform | Candidates in order |
| --- | --- |
| macOS | `terminal-notifier`, `osascript`, `afplay` |
| Linux | `notify-send`, `gdbus` |
| Windows | terminal bell only |

`terminal-notifier` is not installed by default, so macOS without it falls back to `osascript`, whose notifications are attributed to the Script Editor notification permission. On Linux, `notify-send` needs libnotify and a running notification server. Every candidate is killed after five seconds, and a platform without a working candidate ends with the terminal bell

## Boundaries

This is pre-execution protection for Pi `bash` tool calls, not an operating-system sandbox. It does not cover other custom tools, shells started directly by the user, or scripts that bypass tool calls; use Pi inside a container or OS sandbox when stronger isolation is required

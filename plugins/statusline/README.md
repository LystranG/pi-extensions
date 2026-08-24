# @lystran/pi-statusline

Compact multi-line custom statusline for Pi coding agents, showing the full current path, session name, Git branch, model, thinking level, context usage, and session token statistics

```text
❯ Enter a message
╭ 󰉋 ~/programming/ai/pi-extensions · ◈ Fix statusline ·  main ──────── 󰃭 2026-08-21 16:32 ╮
│ 󰍛 ◔ 42k/128k 33% · ↓159K ↑12K W4K R96K 󰆼88.1%                                      │
╰ 󰒍 MCP: 3 servers enabled · LSP Active ────────────────────────────────────────────────╯
```

## Requirements

- Pi coding agent `>=0.84.2`
- Node.js `>=20`
- A terminal font with Nerd Font icons is recommended

## Installation

```bash
pi install npm:@lystran/pi-statusline
```

For local development:

```bash
cd plugins/statusline
pi install -l .
```

## Behavior

- Missing session names, Git data, models, thinking levels, and context data do not display placeholders
- The statusline uses the current Pi theme instead of hard-coded ANSI colors
- The first input line uses the theme accent color for the `❯` prompt; multi-line input and completion continue to use Pi's default editor behavior
- Status items use `·` for clear grouping, with Nerd Font icons for directory, model, thinking, context, and cache information
- The multi-line statusline uses a terminal-width rounded frame, with the first and last status items embedded in the top and bottom borders
- The local date and time, precise to the minute, appear at the right side of the first line and are hidden when space is insufficient
- The full current path is displayed, with the home directory abbreviated to `~`, for example `~/programming/ai/pi-extensions`
- When the terminal becomes narrow, other extension statuses, the session name, Git branch, thinking level, and model are removed first; the full path is truncated last
- Statuses registered by other extensions through `setStatus` are merged when space permits
- The Git branch is green, and Git changes are compacted into one field, for example `!2 !1 +3`
- Git status shows untracked, working-tree, and staged changes as `!n` (blue), `!n` (orange), and `+n` (orange)
- The second line shows context usage and cumulative session tokens: input uses `↓`, output uses `↑`, cache creation uses `W`, cache reads use `R`, and `󰆼` represents the latest request's cache hit rate; when model token usage is available, cache values are shown even when zero, using `K` units and carrying to `M` at four digits
- Context and session token/cache statistics occupy the second line; known `mcp` and `pi-lens-lsp` statuses appear on the third line as `󰒍 MCP:` and `LSP Active`, preserving their original text and theme colors
- Unknown or renamed third-party extension statuses are preserved dynamically on the main status line; known keys are used only for special layout and the MCP icon
- Context icons show `○`, `◔`, `◑`, `◕`, or `●` based on usage; usage above 80% uses the theme's error color
- The custom footer is enabled only in TUI mode

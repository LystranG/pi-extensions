# Pi Extensions Workspace

Bun workspace monorepo for developing and publishing personal Pi coding agent extensions

## Contents

- `plugins/`: Independently publishable `@lystran/pi-<name>` Pi packages
- `packages/`: Shared packages created only when there is real reuse
- `.pi/skills/`: Agent skills used only for repository development
- `docs/research/`: Technical research based on primary sources

## Common Commands

```bash
bun install
bun run check
bun run typecheck
bun run test
bun run pack:check
bun run verify
```

Use `bun changeset` to record changes that affect published workspaces

## Adding a Plugin

Create an independent package in `plugins/<name>`, use the `@lystran/pi-<name>` package name, and put the Pi extension entry point in `src/index.ts`. See `AGENTS.md` for the complete constraints

For local development, run `pi install -l .` from the plugin directory, then run `/reload` in Pi after changing the source

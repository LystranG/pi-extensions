# Pi Extensions Workspace

用于开发和发布个人 Pi coding agent extensions 的 Bun workspace monorepo

## 目录

- `plugins/`：可独立发布的 `@lystran/pi-<name>` Pi packages
- `packages/`：存在真实复用后创建并独立发布的共享 packages
- `.pi/skills/`：仅用于仓库开发的代理 skills
- `docs/research/`：基于一手资料的技术调研

## 常用命令

```bash
bun install
bun run check
bun run typecheck
bun run test
bun run pack:check
bun run verify
```

影响已发布 workspace 的改动使用 `bun changeset` 记录版本变化

## 新增插件

在 `plugins/<name>` 创建独立 package，使用 `@lystran/pi-<name>` 包名，并把 Pi extension 入口放在 `src/index.ts`。完整约束见 `AGENTS.md`

本地开发时，从插件目录执行 `pi install -l .`，修改源码后在 Pi 中执行 `/reload`

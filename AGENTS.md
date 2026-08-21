# 仓库代理约束

本仓库用于开发和发布 Pi coding agent extensions。每个 `plugins/<name>` 是独立发布的 Pi/npm package；只有出现真实复用时，才在 `packages/<name>` 创建共享 package

## 约束

- 插件目录：`plugins/<name>`，入口：`src/index.ts`，包名：`@lystran/pi-<name>`
- 直接发布 TypeScript；`pi.extensions` 指向 `./src/index.ts`，`files` 包含 `src`
- 使用 TypeScript、ESM、严格类型检查，Node.js `>=20`
- Bun 只用于安装、脚本、测试和工具链
- 生产代码禁止 `Bun.*`、`bun:`、`bun` 包和 Bun 专有 API
- Node 内置模块使用 `node:` 前缀
- 只使用 Pi coding agent 的公开导出，不引用 `dist` 或内部源码
- 运行时依赖写入插件自己的 `dependencies`
- Pi coding agent 同时写入 `peerDependencies` 和 `devDependencies`
- 源码注释使用简体中文，末尾不加句号；文档使用简体中文
- `.pi/skills/` 仅供开发代理使用，`docs/research/` 保存调研报告

## 测试与发布

- 只测试关键行为、边界和回归风险，不访问真实网络或模型
- 使用 `bun changeset` 管理发布改动
- 发布前从 npm tarball 执行真实 `pi install` 冒烟验证

## 调研

涉及 Pi API、技术选型或版本兼容性时，先启动 `researcher` 子代理，并要求其读取 `.pi/skills/research/SKILL.md`

优先使用官方文档、源码和规范，报告写入 `docs/research/<topic>.md`。本机 API 与在线文档冲突时，以本机公开 API 为准

## 验证

```bash
bun run verify
```

本地开发：在插件目录执行 `pi install -l .`，修改后在 Pi 中执行 `/reload`

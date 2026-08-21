# 仓库代理约束

## 目标

本仓库用于开发和发布 Pi coding agent extensions。每个 `plugins/<name>` 都是可独立版本化和发布的 npm/Pi package，共享运行时代码放在 `packages/<name>` 并作为独立 npm package 发布

## 开发流程

1. 开始修改前先读取目标 workspace 的 `package.json`、README 和相邻测试，沿用现有结构
2. 新插件放在 `plugins/<name>`，包名使用 `@lystran/pi-<name>`，Pi 入口固定为 `src/index.ts`
3. 插件直接发布 TypeScript 源码，`package.json` 的 `pi.extensions` 指向 `./src/index.ts`，`files` 包含 `src`
4. 运行时依赖必须声明在目标 workspace 的 `dependencies`，不得依赖根目录提升后偶然可见的依赖
5. Pi coding agent 包同时声明为 `peerDependencies` 和 `devDependencies`，不得打包另一份 Pi runtime
6. 发布相关行为变更运行 `bun changeset`，选择实际受影响的 workspace 和正确的 semver 级别
7. 完成修改后运行 `bun run verify`，插件发布前还要从 npm tarball 执行一次真实 `pi install` 冒烟验证

## 技术约束

- 使用 TypeScript 和 ESM，开启严格类型检查
- Bun 只用于依赖安装、脚本、测试和开发工具链
- 生产源码以 Node.js `>=20` 为运行基线，只使用 Node 标准 API 和 Node 兼容 npm 包
- 生产源码不得使用 `Bun.*`、`bun:` 模块、`bun` 包或 Bun 专有解析行为
- Node 内置模块使用 `node:` 前缀
- 只从 Pi coding agent package 的公开导出导入 API，不引用 `dist` 或内部源码路径
- 源码注释使用简体中文，注释末尾不使用句号
- 仓库文档默认使用简体中文

## 测试约束

- 只编写覆盖关键行为、边界和回归风险的测试
- 优先测试纯逻辑和 extension 注册契约；只有真实加载或打包行为无法由单元测试证明时才增加集成测试
- 测试不得访问真实网络或调用真实模型
- 避免重复断言、实现细节断言、大型快照和仅为提高覆盖率存在的测试
- 测试可以使用 `bun:test`，测试辅助代码不得进入生产源码或发布文件

## 调研约束

当任务涉及 Pi API、第三方技术选型、版本兼容性或其他需要外部事实的内容时，先启动 `researcher` 子代理，并要求它完整读取 `.pi/skills/research/SKILL.md`

调研必须优先使用官方文档、官方源码、规范和一方 API，并把带来源的简体中文报告写入 `docs/research/<topic>.md`。主代理审阅报告后再据此实施；若本机安装版本与在线文档冲突，以本机版本的公开 API 和实际验证结果为准

## 目录边界

- `.pi/skills/` 只服务本仓库的开发代理，不会自动成为插件发布内容
- `plugins/` 只放可独立安装的 Pi extensions
- `packages/` 只放出现真实复用后抽取的共享 npm packages
- `docs/research/` 保存可追溯的一手资料调研
- 不创建没有实际消费者的共享包、占位插件或预防性抽象

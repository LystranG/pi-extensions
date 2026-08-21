# Pi 插件开发仓库建设研究

> 调研基线：本机 `~/.pi/agent/settings.json` 的 `lastChangelogVersion` 为 `0.84.2`；报告以该安装版本的本机文档路径为核对入口，并以 Pi 官方仓库文档、源码、示例和 Bun 官方文档为一手资料。官方 `main` 仍会变化，实施时应以实际安装版本的类型导出为准。

## 结论摘要

建议把本仓库先建设为一个**可直接安装的 Pi package**，根目录只有一个 `package.json` 和一个 `bun.lock`，每个 extension 放在 `extensions/<name>/index.ts`，共享代码放 `src/`，测试放 `test/`。这既符合 Pi 的自动发现规则，也避免每个小插件重复维护清单、锁文件和发布流程；只有当插件确实需要独立版本、独立依赖树或独立 npm 发布时，才改成 Bun workspace。

开发工具链可用 Bun 完成安装、脚本、类型检查和快速单测，但 extension 的目标运行时应视为 **Pi 所在的 Node.js 环境**：业务源码只使用 Node 标准 API和普通 npm 包，不使用 `Bun.*`、`bun:` 模块或 Bun 专有行为。Pi 通过 jiti 直接转译并加载 TypeScript，通常**不需要构建产物**；如决定发布编译后的 JavaScript，则必须让 `pi.extensions` 指向实际随包发布的 `.js`，并在 Node 下做验收。

## 术语边界

| 术语 | 在 Pi 中的准确含义 | 对本仓库的含义 |
| --- | --- | --- |
| **extension** | 一个默认导出 extension factory 的 `.ts`/`.js` 模块。它在启动时执行，可订阅生命周期事件，注册工具、命令、快捷键、flags、provider、UI 等。扩展代码拥有与 Pi 进程相同的权限，并非沙箱。见本机 `.../@mariozechner/pi-coding-agent/docs/extensions.md` 与[官方 extensions 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)。 | 每个插件的运行入口；推荐 `extensions/<name>/index.ts`。 |
| **plugin** | Pi 官方资源模型里没有独立的 `plugin` 类型；社区通常把 extension 或包含 extension 的 Pi package 泛称为 plugin。 | 仓库文档中最好使用官方词 `extension`；“插件”仅作中文泛称。 |
| **Pi package** | 一个可由本地路径、npm 或 git 引用的分发/安装单元。它可同时携带 extensions、skills、prompts、themes；资源可按约定目录自动发现，也可由 `package.json` 的 `pi` 字段显式声明。见本机 `docs/packages.md` 与[官方 packages 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)。 | 根仓库可先作为一个 package，内部提供多个 extension；package 不等于 extension。 |
| **npm package** | npm 注册表与 Node 依赖管理的包。它只有在包含 Pi 约定目录或 `pi` manifest 时才同时是 Pi package。 | 发布到 npm 时，一个 npm tarball 承载一个 Pi package。 |
| **skill** | 带 YAML frontmatter 的 `SKILL.md`（或兼容的单文件 Markdown）及其辅助文件。Pi 启动时发现其名称/描述，代理在相关任务中读取完整内容；skill 是给模型的操作知识，不是在 Pi 进程中执行的 extension 代码。见 README 的 Customization/Skills、[pi-skills](https://github.com/badlogic/pi-skills)和本机 `docs/packages.md`。 | 不要用 skill 实现事件钩子、工具注册或 UI；可作为 extension 的配套使用说明一起分发。 |
| **SDK** | `@mariozechner/pi-coding-agent` 的程序化嵌入 API，以 `createAgentSession()`、resource loader、session manager 等组装完整 agent。见本机 `docs/sdk.md` 与[官方 SDK 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)。 | 开发普通 extension 不需要自行启动 SDK；SDK 适合集成测试或把 Pi 嵌入另一应用。 |

因此，“一个插件一个目录”应解释为“一个 **extension 入口**一个目录”，而不是强制“一个 extension 一个 npm 包”。

## 推荐仓库结构

### 第一阶段：单根 Pi package（推荐）

```text
pi-extensions/
├── package.json                 # 唯一 npm/Pi manifest
├── bun.lock
├── tsconfig.json
├── README.md
├── extensions/
│   ├── permission-gate/
│   │   └── index.ts             # 只加载此入口；辅助模块可同目录放置
│   └── another-extension/
│       ├── index.ts
│       └── internal.ts
├── src/                         # 跨 extension 共享的纯 Node 兼容代码
├── skills/                      # 可选：<skill>/SKILL.md
├── prompts/                     # 可选：*.md
├── themes/                      # 可选：*.json
└── test/
    ├── helpers/
    │   └── extension-api.ts
    ├── unit/
    └── integration/
```

Pi 的约定发现规则会读取 `extensions/` 下的直接 `.ts/.js`，以及一层子目录中的 `index.ts/index.js`；多文件 extension 因而应把唯一入口命名为 `index.ts`，避免把 helper 当成独立 extension。官方曾专门修复 package 中多文件 extension 的发现一致性，见 [v0.50.7](https://github.com/badlogic/pi-mono/releases/tag/v0.50.7)；当前实现依据在 `packages/coding-agent/src/core/extensions/loader.ts` 和 `src/core/package-manager.ts`。

根清单可依赖约定而不写 `pi` 字段：

```json
{
  "name": "@scope/pi-extensions",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "files": ["extensions", "skills", "prompts", "themes", "README.md"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "test:node": "node --test",
    "pack:check": "npm pack --dry-run"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.84.2"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "^0.84.2",
    "@types/node": "latest",
    "typescript": "latest"
  }
}
```

当资源不在标准目录、要排除文件，或要从 bundled dependency 暴露资源时，再写显式 manifest，例如：

```json
{
  "pi": {
    "extensions": ["extensions/*/index.ts", "!extensions/experimental/**"],
    "skills": ["skills"],
    "prompts": ["prompts"],
    "themes": ["themes"]
  }
}
```

`pi` 字段是资源入口声明，不是 npm 的 `exports`；用户还可在 settings 的 package 对象上追加过滤。完整规则与 bundled dependency 示例见[官方 packages 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)及官方参考包 [pi-package-test](https://github.com/badlogic/pi-package-test)。

### 何时改用 Bun workspace

Bun workspace 适用于以下任一条件：

1. 每个 extension 要独立 npm 名称、semver、README、changelog 和发布权限。
2. extension 的运行时依赖显著冲突，不能接受根包统一升级。
3. 用户应能只安装其中一个 extension，而不是整包加载后再过滤。
4. 某些包包含原生依赖、构建步骤或不同的 Node 版本约束。

建议形态：

```text
package.json                  # private, workspaces: ["packages/*"]
packages/
├── permission-gate/
│   ├── package.json          # 自身 pi manifest、dependencies、files
│   ├── extensions/
│   │   └── index.ts
│   └── test/
└── another-extension/
    └── ...
```

反之，只有几个相关 extension 时使用 workspace 会增加清单、版本、打包验收和发布编排成本，且 Pi 并不会因为它们是 workspace 就获得额外能力。Bun 官方说明 workspace 可用 `workspace:*` 链接内部包并用 `--filter` 执行脚本；但 workspace 安装器可能采用 isolated linker，所以每个 workspace 必须声明自己实际导入的依赖，不能依赖“根目录碰巧可解析”的 phantom dependency。[Bun 1.3 workspace/isolated installs](https://bun.sh/blog/bun-v1.3)

## TypeScript 加载、构建和依赖

### Pi 如何加载

一个最小 extension 是：

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function extension(pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (_args, ctx) => ctx.ui.notify("Hello", "info"),
  });
}
```

Pi 的 loader 使用 jiti 导入 TypeScript/ESM，要求模块默认导出 factory；官方示例可直接用 `pi --extension examples/extensions/permission-gate.ts` 加载，见[官方 extension examples README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/README.md)。因此：

- 开发和普通 Pi package 发布可直接携带 `.ts`，无需 `tsc` emit 或 Bun bundle。
- `tsconfig.json` 主要服务编辑器和 `tsc --noEmit`，不会控制 Pi/jiti 的运行时转译。
- `import type` 不产生运行时依赖；凡运行时 import 的第三方包必须可从 package 的 `node_modules` 解析。
- Node 内置模块使用 `node:fs`、`node:path`、`node:child_process` 等明确 specifier。
- Pi 自身对核心包提供 loader alias，但仍应以所支持 Pi 版本的公开 exports 为界，不导入 `dist/` 或内部源码路径。历史 alias/subpath 解析问题说明了这种耦合风险，见官方 loader 修复 [PR #1821](https://github.com/badlogic/pi-mono/pull/1821)。

### dependencies、devDependencies、peerDependencies

本地开发时，扩展旁边或父目录的 `package.json` 与 `node_modules` 可供 jiti 解析；官方 `examples/extensions/with-deps/` 展示了这一形式。通过 `pi install` 分发时，Pi 对包做生产安装，运行时依赖必须在 `dependencies`，不能只放 `devDependencies`；此行为由官方修复和测试明确覆盖：[omit devDependencies commit](https://github.com/badlogic/pi-mono/commit/ef1fcfcec25973b478fec9dbc3068c908068f9d4)。

建议分类：

- `dependencies`：extension 执行时真正 import 的第三方库。
- `devDependencies`：TypeScript、测试库、lint/format 工具，以及只用于本仓库类型检查/测试的 Pi 包。
- `peerDependencies`：声明兼容的 Pi API 范围；但不要假定 peer 一定替代所有运行时包。实际打包后必须在一个干净目录用真实 Pi 安装验证。
- 若 manifest 指向 `node_modules/<dep>/...` 中的资源，需使用 `bundledDependencies` 保证 tarball 带上依赖，否则 npm hoisting 可能破坏该相对路径；见 [pi-package-test](https://github.com/badlogic/pi-package-test)。

### 是否构建

**默认不构建**最贴近 Pi 官方体验：源文件即安装物，堆栈也直接指向 TS。只有在需要隐藏源码、生成代码、支持其他消费者或严格控制发布体积时才构建。若构建：

1. 输出 ESM JavaScript到 `dist/extensions/<name>/index.js`。
2. `pi.extensions` 必须显式指向这些 `.js`，不能仍指向 `src`。
3. `files` 必须包含 `dist`，并用 `npm pack --dry-run`/解包检查。
4. 外部化 Node built-ins 与 Pi peer 包，不把另一份 Pi runtime 打入 bundle。
5. 在 Node 下 import/加载产物；不能只用 Bun 跑过。

## Bun 工具链与 Node 兼容边界

Bun 可安全承担 package manager、script runner、`bun test` 和可选 bundler。Bun 官方明确说明 `bun install` 可用于不切换运行时的 Node 项目：[Behind the Scenes of Bun Install](https://bun.sh/blog/behind-the-scenes-of-bun-install)。但 Bun 的 Node 兼容性仍在持续完善，因此“Bun 测试通过”不等于“Pi/Node 运行通过”。

建议约束：

- extension 源码禁止 `import ... from "bun"`、`bun:*`、`Bun.file`、`Bun.spawn`、`bun:test` import 和仅 Bun 支持的 resolver 行为。
- 测试可以用 `bun:test`，但共享测试对象不要泄漏进生产源码。
- 使用 `@types/node` 作为生产源码环境类型；只有测试配置需要 `@types/bun`。Bun 的 TS quickstart 对 Bun 类型的配置见[官方文档](https://bun.sh/docs/quickstart)。
- CI 同时固定 Bun 与 Node 版本；`bun install --frozen-lockfile` 后运行 `tsc --noEmit`、`bun test`，再运行 Node/Pi 集成测试。
- 对每个 package 明确声明依赖；不利用 Bun workspace hoisting 让未声明依赖偶然可见。
- 若用 `bun build`，目标必须是 Node/普通 ESM，而不是 `--compile` 的 Bun 可执行文件；Pi 需要导入模块，不是启动另一个 runtime。

## 测试策略

测试应分四层，风险由低到高：

1. **纯逻辑单测**：把解析、策略、状态转换放在不依赖 Pi 的函数中，用 `bun:test` 覆盖边界、异常和取消信号。
2. **factory 契约测试**：用最小 fake `ExtensionAPI` 捕获 `on`、`registerTool`、`registerCommand`、`registerShortcut` 等注册；调用默认导出，断言名称唯一、schema、handler 和事件结果。fake 应通过 `satisfies Pick<ExtensionAPI, ...>` 约束，避免 API 漂移被 `any` 隐藏。
3. **真实 loader/SDK 集成测试**：从已发布的 `@mariozechner/pi-coding-agent` 使用公开的 extension loader/resource loader 或 `createAgentSession()`，在临时目录加载 fixture，检查 load errors、命令/工具注册和 reload。`discoverAndLoadExtensions` 已因 extension 测试需求加入公开导出，背景见[官方 issue #1148](https://github.com/badlogic/pi-mono/issues/1148)；具体签名以本机 `docs/sdk.md` 和安装版本 `.d.ts` 为准。
4. **真实 CLI 冒烟**：`pi -e ./extensions/<name>/index.ts` 验证 TypeScript 入口；`pi install -l .` 验证 package 发现；在交互会话执行 `/reload` 并检查命令/工具。涉及 TUI 的 extension 还应在真实终端验证无 UI/print/RPC 分支，不能只 mock `ctx.ui`。

发布门禁建议：

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
node --test                    # 若有 Node 原生集成套件
npm pack --dry-run
pi -e ./extensions/<name>/index.ts
```

另在临时目录解开 `npm pack` 生成的 tarball，再执行 `pi install <tarball-or-dir>`；这会发现 workspace hoisting、遗漏 `files`、运行时依赖误放 `devDependencies`、manifest 指向源码但源码未发布等问题。测试应避免真实网络/LLM：SDK session 使用 in-memory settings/session manager 和 fake model/provider；只有很薄的一层人工 smoke test 使用真实服务。

## 本地发现与开发循环

Pi 支持以下入口，详见 README Customization、`docs/extensions.md`、`docs/packages.md` 和 `docs/settings.md`：

- 单次加载：`pi -e ./extensions/foo/index.ts` 或 `pi --extension ...`。
- 项目自动发现：`.pi/extensions/foo/index.ts`；适合只属于某项目的资源。
- 用户自动发现：`~/.pi/agent/extensions/foo/index.ts`；适合个人全局资源。
- settings 显式路径：`.pi/settings.json` 或 `~/.pi/agent/settings.json` 的 `extensions` 数组，可写文件或目录；路径相对对应 settings 所在的 `.pi`/agent 目录解析。
- package 本地开发：在仓库根执行 `pi install -l .`，把本地路径加入项目 `.pi/settings.json`。Pi 对本地 package 直接引用源目录而非复制，因此修改后通常 `/reload` 即可。

推荐日常循环是 `bun test --watch` + `pi install -l .` + `/reload`。不要把根 `package.json` 的 `pi` 字段误认为当前项目会自动读取；Pi package 要通过 `pi install .` 或 settings 的 `packages` 明确注册。官方对这一边界的答复见[issue #1839](https://github.com/badlogic/pi-mono/issues/1839)。

项目资源会执行任意代码，首次信任项目时 Pi 会提示；团队仓库应把 `.pi/settings.json` 纳入代码审查，并避免自动加载未知远端浮动版本。设置模型和过滤规则见[官方 settings 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)。

## 安装、版本与发布

### 安装方式

```sh
# npm，全局用户范围
pi install npm:@scope/pi-extensions

# npm，项目范围（写入 .pi/settings.json）
pi install -l npm:@scope/pi-extensions

# git；省略 ref 表示跟随默认分支
pi install git:github.com/org/pi-extensions

# git 固定 tag/commit
pi install git:github.com/org/pi-extensions@v1.2.3

# 本地目录；开发首选
pi install -l .

# 单次试用，不持久安装
pi -e npm:@scope/pi-extensions
```

全局 npm/package 数据在 Pi agent 目录管理的安装位置，项目 npm 安装在 `.pi/npm/`，git 分别落在用户或项目的 git 区域；精确路径和 source 语法以本机 `docs/packages.md` 为准。`pi list` 查看来源，`pi update` 更新未固定来源，`pi remove` 移除。npm 明确版本和 git tag/commit 会被视为 pinned，更新会跳过；git 要“跟随最新”应省略 `@ref`，不要写 `@latest`，官方解释见[issue #3115](https://github.com/badlogic/pi-mono/issues/3115)。

### npm 发布清单

1. package 名称唯一，`type: "module"`，加入 `pi-package` keyword。
2. 标准资源目录可零 manifest；为可审计性和排除测试 helper，也可显式写 `pi` globs。
3. `files` 只包含运行资源、README、LICENSE 和必要产物，排除 test、coverage、源码映射秘密和本地配置。
4. 运行时包放 `dependencies`，Pi API 兼容范围放 `peerDependencies`，并在 `devDependencies` 安装一个具体 Pi 版本用于 CI。
5. `npm pack --dry-run` 后检查 tarball，再从 tarball 干净安装。
6. `bun publish` 与 npm registry 兼容，但发布前仍建议用 npm 的 pack/publish dry-run 视角验证，因为 Pi 的远端安装语义是 npm package，而非 Bun workspace。
7. README 明确最低 Pi 版本、安装命令、注册的命令/工具、环境变量、权限和卸载方式。

### git 发布

Git 源适合未上 npm 的 package，但仓库根必须本身就是可发现的 Pi package；不要指向一个更大 monorepo 根并期待 Pi 猜出其中某个子包。为稳定用户发布 tag；默认分支源会随 `pi update` 前进，适合开发通道，不适合不可控的生产安装。

## 对本仓库的实施决策

1. 采用**单根 package**，不立即上 workspace。
2. 每个 extension 使用 `extensions/<name>/index.ts`，共享逻辑进入 `src/`，禁止跨插件深层相对引用到对方内部文件。
3. 默认发布 TypeScript 源码，不设置 build step；设置严格 `tsc --noEmit`。
4. Bun 仅作工具链；生产源码以 Node API 为兼容基线。
5. 根 package 用标准目录自动发现；只有需要过滤或非标准资源时增加 `pi` manifest。
6. 单测使用 Bun；另设真实 Pi loader/CLI 和打包后安装测试。
7. 当且仅当插件需要独立发布或依赖隔离时迁移 `packages/*` workspace；迁移后每个 workspace 自身必须是完整 Pi package。

## 风险与注意事项

- **高**：把运行时依赖放进 `devDependencies`。本地可因 hoisting 正常，用户经 `pi install` 后会加载失败。
- **高**：生产源码使用 Bun 专有 API。开发测试可通过，但真实 Pi 的 Node runtime 会失败。
- **高**：把未经审查的 project/local/remote extension 自动加载。extension 与 Pi 同权限，可读写文件、执行命令和访问网络。
- **中**：目录里有多个 `.ts` 且没有明确 `index.ts`/manifest，helper 可能被错误当作 extension；坚持每目录唯一入口。
- **中**：只测试源码路径，不测试 npm tarball。`files`、manifest、workspace hoisting 和 production install 问题会被遗漏。
- **中**：直接依赖 Pi 内部 `dist` 路径或未公开 subpath。loader alias 和内部布局曾发生变化，应只用公开导出并声明最低 Pi 版本。
- **低**：过早采用 workspace，造成多重版本/发布工作而无用户收益；保持可迁移目录边界即可。

## 一手资料索引

### 本机安装文档入口

以下文件应作为本机版本的最终 API 依据（安装根目录为 `@mariozechner/pi-coding-agent`）：

- `README.md`：CLI、Customization、Skills、Extensions、Pi Packages、SDK 总览。
- `docs/extensions.md`：factory、事件、工具/命令/UI、加载位置、依赖与示例交叉引用。
- `docs/packages.md`：自动发现、`pi` manifest、过滤、npm/git/local 安装、更新与 pinning。
- `docs/sdk.md`：`createAgentSession()`、resource loader、settings/session manager、嵌入测试。
- 交叉引用：`docs/settings.md`、`docs/skills.md`、`docs/tui.md`、`examples/extensions/README.md`、`examples/extensions/with-deps/`、`examples/sdk/`。

### 官方在线资料

- [Pi coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [Extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [Settings](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)
- [Extension examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [Extension loader source](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/loader.ts)
- [Package manager source](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/package-manager.ts)
- [Package manager tests](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/test/package-manager.test.ts)
- [Official reference Pi package](https://github.com/badlogic/pi-package-test)
- [Bun workspace/isolated install](https://bun.sh/blog/bun-v1.3)
- [Bun TypeScript quickstart](https://bun.sh/docs/quickstart)

## 调研缺口

本轮未实际搭建 package 或运行 smoke test，因为任务限定只写研究文件。在线 `main` 文档可能晚于本机 `0.84.2`；真正实施时应再从本机安装包的 `.d.ts` 核对 `ExtensionAPI`、公开 loader 和 SDK 构造参数，并用本机 `pi --version`、`pi install -l .` 与 tarball 安装测试锁定兼容范围。

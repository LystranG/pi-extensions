# Research: pi-session-rename `/auto-rename` public API

## Summary

可行。已确认产品行为：命令立即基于触发时当前分支上下文快照生成，主 agent 工作时也不等待；概括会话整体主线；重复执行取消旧请求、最新一次生效；成功直接覆盖已有名称（包括用户手动名），失败保留旧名。推荐根包公开函数 `buildSessionContext(entries, leafId)` + 现有 `ctx.modelRegistry.complete()` + `pi.setSessionName()`；核心读上下文与模型调用接口已在本机 0.84.2、0.87.1 声明核对，无需真实网络模型验证。

本次仅 API 调研，无源代码修改，唯一写入为本报告 artifact。

## Evidence paths

精确本机路径缩写（下列引用附文件内符号/小节定位）：

- `PI87/` = `/Users/lystran/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.87.1/node_modules/.mise/@earendil-works+pi-coding-agent@0.87.1/node_modules/@earendil-works/pi-coding-agent/`
- `PI84/` = `/Users/lystran/programming/ai/pi-extensions/plugins/pi-session-rename/node_modules/@earendil-works/pi-coding-agent/`；该 package.json 确认为 0.84.2
- `PLUGIN/` = `/Users/lystran/programming/ai/pi-extensions/plugins/pi-session-rename/`

## Findings

1. **Claim: 使用命令 handler 可立即启动独立命名请求。** **Sources:** `PI87/dist/core/extensions/types.d.ts`：RegisteredCommand / ExtensionCommandContext；`PI84/dist/core/extensions/types.d.ts`：ExtensionCommandContext；`PI87/dist/core/agent-session.js`：prompt / _tryExecuteExtensionCommand / _queueUserInput；[官方 agent-session.ts](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/agent-session.ts)。**Support:** direct evidence。**Confidence:** high。

   `pi.registerCommand("auto-rename", { description, handler })` 的 handler 类型是 `(args: string, ctx: ExtensionCommandContext) => Promise<void>`。0.87.1 的 prompt 在 input hooks、compaction 检查、普通流式输入队列前分派扩展命令；匹配后返回，不触发普通用户 turn。因此主 agent 忙时不必等待，命令自身也不会走插件现有 input / before_agent_start 首句命名链。限定：通过 prompt 且启用命令展开时成立；直接 steer/followUp 遇到注册命令会拒绝；正在发射 agent_settled 时 prompt 有短暂延迟。已确认产品行为要求**不调用 waitForIdle**。

2. **Claim: 最低版本可用根包自由函数 buildSessionContext，不能直接用 0.87.1 新接口。** **Sources:** `PLUGIN/package.json`；两版本 `dist/index.d.ts`、`dist/core/session-manager.d.ts`、`dist/core/model-registry.d.ts`；`PI84/package.json`。**Support:** direct evidence。**Confidence:** high。

   插件 peerDependencies 是 Pi >=0.84.2，devDependencies 是 0.84.2。两版本均从根包公开导出 `buildSessionContext`；正确组合为 `buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages`，明确传当前 leaf（包括 null）。两版本的扩展只读 session manager 均不包含实例 buildSessionContext 方法。**0.84.2 没有 buildSessionProjection，也没有 registry.streamSimple；不能直接采用这两个 0.87.1 接口并继续声称支持当前最低版本。** complete 在两版本均公开。生产代码仅从根包 import，读取 dist 仅用于取证。

3. **Claim: 上下文重建保留压缩摘要；getBranch 是原始路径。** **Sources:** 两版本 `dist/core/session-manager.d.ts`：getBranch / buildContextEntries / buildSessionContext；`PI87/docs/session-format.md`：Context Building / CompactionEntry / ContextEditEntry；`PI87/docs/message-types.md`：AssistantMessage。**Support:** direct evidence。**Confidence:** high。

   getEntries 包含所有分支；getBranch 沿当前 leaf 回溯，保留原始消息、压缩前历史及 compaction 等所有类型条目。buildSessionContext 选择当前分支，用最新 compaction 摘要替代已概括历史，保留 firstKeptEntryId 起的保留消息和压缩之后消息，并转换 branch summary。只筛 getBranch 中 user/assistant 会漏摘要；整条原始 branch 直接串联又会重复旧历史与摘要。0.87.1 的重建还应用 context_edit 删除/替换，0.84.2 无该 entry 类型；公共函数服从运行版本自身语义。

   **Researcher inference / 建议：** 命令开始后，在第一次 await 之前同步读取 entries、leaf、model、sessionId，并转换成自有文本快照；保留摘要与完整分支主线，不能只截最近话题。此快照来自已完成的 session entries，**不包括当前尚在流式生成的 assistant 片段**（文档明确 pending assistant 不落 session JSONL），也不应宣称包含未交付的队列输入。上下文重建并不逐字等同于下一次 provider 请求，因为请求时 hooks 仍可能变换内容（`PI87/docs/extensions.md`：context / context_with_system）。

4. **Claim: 独立模型请求与更新名称均有公开 API。** **Sources:** 两版本 `dist/core/model-registry.d.ts`：complete；`PI87/examples/extensions/custom-compaction.ts`；`PI87/dist/core/agent-session.js`：setSessionName；`PI87/dist/core/extensions/types.d.ts`；`PLUGIN/src/index.ts`。**Support:** direct evidence。**Confidence:** high。

   `ctx.modelRegistry.complete(model, context, options)` 返回 AssistantMessage，官方示例也使用；现有插件包装可沿用，保留 provider header adapter，并捕获请求 sessionId，防止重试读取变化后的共享变量。`pi.setSessionName(title)` 写入 session_info 并发射 session_info_changed。有效标题成功后直接调用，失败不调用，即符合覆盖已有名/失败保留策略；没有“已命名就跳过”的条件。无需 sendUserMessage，后者会触发主 agent turn。

   根包公开 `convertToLlm` 和 `serializeConversation` 可辅助转换，但后者包含 thinking、工具调用和工具输出，且工具输出局部截断不是总预算（`PI87/docs/compaction.md`：Message Serialization）。取材策略应保留整体目标与关键演进，避免无关 system、thinking 或大型输出挤占标题输入。

5. **Claim: 最新请求优先需要插件自己管理取消和提交条件。** **Sources:** `PI87/docs/extensions.md`：Context and session changes / Errors and cleanup；`PI87/dist/core/extensions/runner.js`：invalidate / assertActive / createContext；`PI87/dist/core/extensions/types.d.ts`：SessionShutdownEvent / SessionTreeEvent / ExtensionContext；`PLUGIN/src/controller.ts`。**Support:** direct evidence；下列协调方案为 researcher inference。**Confidence:** high。

   主 agent 的 ctx.signal 可能 undefined，且归属于主 operation；标题应使用独立 AbortController。每次命令取消前次请求、递增请求序号；返回时检查序号，即使 provider 忽略 abort 也不让旧结果提交。手动命令也需使尚未完成的首句自动命名失效，失败时不能由旧自动结果覆盖原名。

   session_shutdown（quit/reload/new/resume/fork）取消并使请求失效；session_tree 防同 ID 切分支。替换/reload 后捕获的 pi/ctx 会失效，**先检查本地取消/代次再访问 ctx/pi**。不能仅靠 session ID 或 leaf 相等判定：前者挡不住切树，后者会被正常新消息/metadata 推进。按已确认快照语义，普通后续消息不应自动取消本次请求；成功覆盖现有标题，不增加“名称变化就拒绝提交”的额外产品条件。

6. **Claim: 保持格式可复用 title.ts 的约束与校验，输入语义应从首句改为整体主线。** **Sources:** `PLUGIN/src/title.ts`：buildTitleSystemPrompt / wrapUserPrompt / normalizeTitle / isTitleWithinLimit / generateTitle；`PLUGIN/src/controller.ts`。**Support:** direct evidence。**Confidence:** high。

   当前格式是用户语言、具体动作短语、保留标识符、单行无引号/markdown/说明，长度同时满足 20 汉字和 10 非汉字词。当前提示仍写 user's first message，且从头截断 6000 字符；不能直接串联全历史后继续依赖该首句截断。格式规则和有限重试可共享，取材应代表分支整体主线。首句自动控制器的仅一次、恢复会话禁用、已有名称跳过门槛不能套到手动命令。

## Contradictions

- 指定 PI87/docs/session.md 不存在，实际是 docs/sessions.md。已完整读取研究 SKILL.md、extensions.md、sessions.md，以及必要链接全文 session-format.md、compaction.md、sdk.md、message-types.md、how-pi-works.md。
- 0.87.1 的 projection/streamSimple API 与最低 0.84.2 不兼容；最终建议使用两个版本已确认公开的 buildSessionContext 自由函数与 complete。
- 在线 main 与本机 prompt preflight 回调已有差异，在线仅作交叉验证，本机版本优先。

## Missing evidence

- 未编译实现、运行 TUI/RPC 测试或调用真实模型。0.84.2 核心声明已确认，但其完整分派/失效实现未逐行核对，0.87.1 的具体顺序不作为所有 >=0.84.2 版本保证。
- 搜索遇 Brave 429/无结果；已注册 source_check 返回 missing-evidence（无片段）。本报告使用本机一手证据和官方原始源码补足，不宣称网络自动核验通过。
- 快照只含已完成历史；长上下文预算对整体主线的保真度仍需离线样例验证。

## Sources

- Kept: 上述本机 0.87.1 文档、公开声明与关键安装实现 — 版本精确的一手证据。
- Kept: 插件本机 0.84.2 package.json、公开根导出及类型声明 — 最低版本兼容边界。
- Kept: [官方 agent-session.ts](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/agent-session.ts) — 分派与名称写入交叉验证。
- Kept: 插件 package.json 和现有源码 — 格式及复用边界。
- Rejected/deprioritized: 无证据的搜索摘要/source_check；未用第三方文章。

## Next steps

实现后离线验证两版本类型、当前分支压缩摘要、忙时立即快照、重复调用 latest-wins、自动/手动竞争、会话切换/reload/切树失效，以及成功覆盖/失败保留。无需新增 API 调研或真实模型调用来确认基础可行性。

## 主代理补充核实

- 实现阶段直接核对本机 Pi 0.84.2 的 `dist/core/agent-session.js:792–835`：`prompt()` 在 `isStreaming` 排队检查之前调用 `_tryExecuteExtensionCommand()`，确认最低版本也支持忙时立即分派扩展命令；生产代码不引用这些内部路径
- 通过真实 `SessionManager.inMemory()` 与可控模型替身验证当前分支选择、压缩摘要、输入预算、请求竞争和失效行为；没有调用真实网络模型，也未把测试替身当作真实 TUI/RPC 验证
- 实现完成并修复审查发现的空命令消耗首次命名机会问题后，`bun run verify` 通过：206 项测试、类型检查、Biome 和 5 个 workspace package 的打包检查均通过
- `pre-commit run --all-files` 因仓库未提供 `.pre-commit-config.yaml` 无法执行；未添加临时配置或绕过提交钩子

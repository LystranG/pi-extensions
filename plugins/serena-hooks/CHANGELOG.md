# @lystran/pi-serena-hooks

## 0.2.0

### Minor Changes

- 930d8e8: Fix Serena reactivation after rewinding the session tree, forward Serena's reminder context, and clean up hook data on session replacement
  
  - Re-run `activate` when a `session_tree` navigation rewinds the branch to before the first user message, detected from the post-navigation branch instead of the never-null `newLeafId`
  - Queue activation context with `deliverAs: "nextTurn"` so it is injected in the same turn as the next user message instead of one turn later
  - Queue at most one rewind activation per upcoming user message so repeated navigation before sending does not stack duplicate context
  - Include Serena's `additionalContext` in the blocked tool result so the reminder reaches the model
  - Run `cleanup` on `quit`, `new`, `resume`, and `fork`, while skipping `reload` because it keeps the same session
  - Remove the redundant resume-time reactivation that injected the activation context twice
  - Export `createSerenaHooksExtension` and `formatDenyReason` so the lifecycle wiring and the deny-reason formatting can be tested and reused

## 0.1.4

### Patch Changes

- 892cd47: Reactivate Serena after navigating the session tree back to its root user message

## 0.1.3

### Patch Changes

- 9290062: Re-run the Serena activate hook when a resumed session receives a message at its first user message

## 0.1.2

### Patch Changes

- c9ce33f: 归一化 Pi 原生、FFF 和 Bash 搜索工具的 Serena hook payload，兼容 Serena 的 Claude Code hook 格式，并补充 CLI 前置需求与集成插件文档

## 0.1.1

### Patch Changes

- 8e9e957: 收窄 Serena remind 的工具范围，兼容 Pi 原生和 FFF 的搜索工具，拆分 hook 执行、输出解析、工具匹配与生命周期控制模块

## 0.1.0

### Minor Changes

- ec4ecc4: 新增支持 session 名称的简约图标化 statusline，以及映射 Pi 生命周期的 Serena hooks 插件。

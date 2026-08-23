# Serena Hooks 与 FFF 兼容性调研

## 结论

`@lystran/pi-serena-hooks` 的 `remind` 应监听 Pi 中代表代码搜索或终端执行的工具：

```text
bash
grep
ffgrep
multi_grep
fff-multi-grep
```

不监听 `read`、`find` 或 `fffind`。这样可以保留 Serena 对搜索和 Bash 使用方式的提醒，同时避免连续读取 skill、源码和文档时触发 Serena 的读取计数并阻断工具调用。

## Serena 官方语义

Serena 的 `remind` 是 `PreToolUse` hook，用于在 agent 连续使用代码搜索或文件读取工具、但没有穿插 Serena symbolic tools 时进行提醒。

不同客户端的官方匹配范围不同：

- Claude Code 使用空 matcher，因此所有工具都可能触发 `remind`
- Codex 使用 `Bash` matcher，因为 Codex 的主要工具入口是 Bash
- Grok 显式匹配 `grep|read_file|run_terminal_command`

Pi 同时提供原生 `bash`、`grep`、`read`、`find` 等工具，因此不能直接复制 Codex 的 Bash-only 配置，也不适合直接复制 Claude Code 的全量 matcher。当前插件选择 Pi 语义下的 Bash 和搜索工具，并排除 `read` 以避免 skill 加载被拦截。

## FFF 工具与模式

FFF Pi 扩展通过 `/fff-mode` 支持三种模式：

| 模式 | FFF 工具名 | 与 Pi 内置工具的关系 |
| --- | --- | --- |
| `tools-and-ui` | `ffgrep`、`fffind`，可选 `fff-multi-grep` | 增加 FFF 工具并替换 mention 补全 |
| `tools-only` | `ffgrep`、`fffind`，可选 `fff-multi-grep` | 只增加工具，不替换原生补全 |
| `override` | `grep`、`find`，可选 `multi_grep` | 用 FFF 实现替换 Pi 同名工具 |

`fff-multi-grep` 和 `multi_grep` 只有在 `PI_FFF_MULTIGREP=1` 时注册。匹配器同时支持这两个名字，因此不需要读取 FFF 当前模式，也能在模式切换和 `/reload` 后保持兼容。

`fffind` 和 `find` 是路径/文件名搜索，不属于 Serena 官方 `grep`/`read_file` 提醒范围，因此不触发 `remind`。

## 实现边界

- Serena 命令执行、JSON 输出解析、工具匹配和生命周期控制分别位于独立模块
- 插件不依赖 FFF 的内部 API，只依赖其公开且稳定的工具名
- Serena 命令失败、超时或退出非零时不阻断 Pi
- 只有 Serena 明确返回 `decision: "deny"` 时，Pi 才阻断匹配的工具调用

## 来源

- Serena 官方客户端指南：https://oraios.github.io/serena/02-usage/030_clients.html
- FFF README：https://github.com/dmtrKovalenko/fff
- FFF Pi 扩展源码：https://raw.githubusercontent.com/dmtrKovalenko/fff/main/packages/pi-fff/src/index.ts
- FFF Pi 包清单：https://raw.githubusercontent.com/dmtrKovalenko/fff/main/packages/pi-fff/package.json
- 本机 Pi 扩展 API：`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

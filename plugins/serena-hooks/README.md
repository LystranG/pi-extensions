# @lystran/pi-serena-hooks

把 Serena 的生命周期命令接入 Pi coding agent。插件会为 Serena hook 注入 JSON stdin，并显式使用 `claude-code` client 兼容 Pi 的原生工具事件。

## 要求

- Pi coding agent `>=0.84.2`
- Node.js `>=20`
- `serena-hooks` 可执行文件已加入 `PATH`

## 安装

```bash
pi install npm:@lystran/pi-serena-hooks
```

本地开发：

```bash
cd plugins/serena-hooks
pi install -l .
```

## 生命周期映射

| Pi 事件 | 执行命令 |
| --- | --- |
| 任意 `session_start` | `serena-hooks activate --client claude-code` |
| 模型调用 `bash` 前 | `serena-hooks remind --client claude-code` |
| `session_shutdown` 且原因为 `quit` | `serena-hooks cleanup --client claude-code` |

`remind` 监听模型发起的 `bash`、`grep`、`ffgrep`、`multi_grep` 和 `fff-multi-grep` 工具。这样可以兼容 Pi 原生搜索工具，以及 FFF 的 `tools-and-ui`、`tools-only`、`override` 三种模式，同时避免读取 skill、源码或文档时被 Serena 的连续读取提醒误拦截。`find` 和 `fffind` 是路径搜索，不触发 `remind`。每个命令最多等待 10 秒。命令不存在、超时或返回非零时不会阻断 Pi；同一会话内，同一动作只显示一次警告，但后续事件仍会继续尝试执行。

用户通过 `!` 或 `!!` 直接执行的 shell 命令不会触发 `remind`。

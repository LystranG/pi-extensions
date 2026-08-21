1# @lystran/pi-statusline

为 Pi coding agent 提供单行自定义状态栏，显示当前目录、session 名称、Git 分支、模型、思考等级和上下文占用。

```text
 pi-extensions  ◈ 修复状态栏   main  ◆ openai/gpt-5  ◉ high  ◔ 42k/128k (33%)
```

## 要求

- Pi coding agent `>=0.84.2`
- Node.js `>=20`
- 建议使用支持 Nerd Font 图标的终端字体

## 安装

```bash
pi install npm:@lystran/pi-statusline
```

本地开发：

```bash
cd plugins/statusline
pi install -l .
```

## 行为

- 缺失的 session 名称、Git、模型、思考等级或上下文信息不会显示占位符
- 状态栏使用当前 Pi 主题配色，不写死 ANSI 色值
- 终端变窄时先移除其他扩展状态、session 名称、Git 分支、思考等级和模型，优先保留目录与上下文
- 有足够空间时会合并其他扩展通过 `setStatus` 注册的状态
- Git 分支使用绿色显示，Git 变更会紧凑合并为一个字段，例如 `!2!1+3`
- Git 状态按未追踪、工作区变更、暂存区变更显示为 `!n`（蓝色）、`!n`（橙色）和 `+n`（橙色）
- 第二行显示累计 session token：输入使用 `↓`，输出使用 `↑`，单位为 `K`，达到四位数时进位为 `M`
- Pi 原生统计中的 `R` 是缓存读取 token，`W` 是缓存写入 token，`CH` 是最近一次请求的缓存命中率
- 累计 session token 独占第二行；`pi-mcp-adapter` 的 `mcp` 状态和 pi-lens 的 `pi-lens-lsp` 状态显示在第三行，顺序为 `󰒍 MCP:`、`LSP Active`，并保留原状态文本和主题颜色
- 上下文图标会按占用率显示 `○`、`◔`、`◑`、`◕` 或 `●`；超过 80% 时使用主题的 error 颜色
- 自定义 footer 仅在 TUI 模式启用

# @lystran/pi-guard

通过 [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard) 的 `dcg --robot test` 接口，在 Pi 执行 `bash` 工具前检查危险命令，并允许为具体命令配置询问或拒绝

## 安装

先按照 dcg 官方文档安装并确认 `dcg --version` 可用，然后在插件目录执行：

```bash
pi install -l .
```

也可以把发布后的包加入 Pi 的扩展配置

## 配置

插件默认拒绝 dcg 判定为危险的命令。规则文件按以下顺序查找：

- 项目配置：`.pi/guard.json`
- 用户配置：`~/.pi/agent/guard.json`
- `PI_GUARD_CONFIG`：显式指定配置路径

配置示例：

```json
{
  "defaultMode": "deny",
  "headless": "deny",
  "rules": [
    { "command": "rm -rf *", "mode": "confirm" },
    { "command": "git reset --hard *", "mode": "confirm" },
    { "command": "git clean -fd *", "mode": "deny" }
  ]
}
```

规则只覆盖 dcg 已判定为危险的命令；普通安全命令仍由 dcg 判定后正常执行。规则按文件顺序匹配，命中第一条规则。命令中包含 `*` 时，`*` 匹配任意长度的命令文本

也可以显式使用 `match: "exact"`、`"prefix"`、`"wildcard"` 或 `"regex"`。不写 `match` 时，不含 `*` 的命令按完整匹配，包含 `*` 的命令按通配符匹配

可选环境变量：`DCG_BIN`、`DCG_PI_MODE`、`DCG_PI_HEADLESS`、`DCG_PI_TIMEOUT_MS`

dcg 缺失、超时、输出损坏或返回未识别退出码时均拒绝命令。直接拒绝、配置错误和用户取消确认时，Pi 界面会显示通知；询问对话框会显示命令、dcg 原因和命中的配置规则

## 边界

这是 Pi `bash` 工具调用的执行前保护，不是操作系统沙箱。它不覆盖其他自定义工具、用户直接启动的 shell 或通过脚本绕过工具调用的行为；需要更强边界时，应在容器或操作系统沙箱中运行 Pi

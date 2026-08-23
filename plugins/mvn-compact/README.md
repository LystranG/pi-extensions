# @lystran/pi-mvn-compact

给 Pi coding agent 提供 Maven 工具，压缩 Maven 的高噪声命令输出

## 使用边界

这个工具只适用于 Maven 项目。它优先执行当前工作目录的 `./mvnw`，不存在时执行 PATH 中的 `mvn`

AI 调用工具时只传 Maven 参数数组：

```json
{
  "args": ["clean", "test"]
}
```

不要在 `args` 中传入 `mvn`、`./mvnw`、管道、重定向或其他 shell 语法

默认使用 compact 模式：成功时返回短摘要，失败时返回分类诊断、测试报告目录和完整日志路径。完整日志保存到项目下的 `.agent-logs/maven/`，失败日志保留，成功日志默认保留在当前运行期间但不会返回全部内容

`mode: "full"` 用于需要查看 Maven 原始输出的调试场景

工具还会识别影响结果可信度的常见参数：

- `-DskipTests`、`-Dmaven.test.skip`、`-DskipITs` 会返回 `NOT_RUN`
- `-DtestFailureIgnore`、`-Dmaven.test.failure.ignore`、`-fn` 不会让被忽略的测试/构建失败伪装成 `PASS`
- `-Dtest`、`-Dit.test` 和 `failIfNoSpecifiedTests` 会标记空测试选择
- `-q`、`-l`、自定义日志配置导致测试证据缺失时会返回 `UNKNOWN`
- 重试成功的测试会返回 `PASS_WITH_FLAKES`
- `-pl`、`-am`、`-amd`、`-N`、`-rf`、`-T` 和 Reactor 失败策略会在摘要中显示构建范围提示

结果状态包括 `PASS`、`FAIL`、`NOT_RUN`、`PASS_WITH_FLAKES`、`INCOMPLETE` 和 `UNKNOWN`。`Maven exit code: 0` 只代表 Maven 进程返回成功，不代表测试一定完整通过

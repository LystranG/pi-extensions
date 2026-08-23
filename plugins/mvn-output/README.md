# @lystran/pi-mvn-output

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

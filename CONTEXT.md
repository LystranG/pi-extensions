# Pi Extensions Workspace

本上下文定义仓库中 Pi 扩展资产及其发布边界所使用的统一语言

## Language

**插件**：
面向使用者的中文泛称，指本仓库中一个可独立安装和发布的 Pi package
_Avoid_: 项目、模块

**Extension**：
由 Pi 在启动或重载时加载的可执行扩展入口，可注册命令、工具、事件处理器或界面能力
_Avoid_: Skill、Package

**Pi Package**：
Pi 的安装与资源发现单元，可携带一个 Extension 及其运行所需资源
_Avoid_: Extension、Workspace

**Workspace**：
容纳多个独立 Pi Package 和共享 Package 的整体仓库
_Avoid_: 插件、Package

**共享 Package**：
被两个或更多插件复用并独立发布的通用能力单元
_Avoid_: 工具文件、插件内部模块

**开发 Skill**：
位于 `.pi/skills/`、用于指导开发代理完成仓库任务的操作知识，不属于插件运行能力
_Avoid_: Extension、插件

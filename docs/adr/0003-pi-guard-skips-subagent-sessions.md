---
status: accepted
---

# pi-guard 不在子代理会话里生效

`@lystran/pi-guard` 在扩展工厂的第一行判断 `PI_SUBAGENT_CHILD` 是否为 `1`，命中就直接返回：不注册 `tool_call` 处理器、不创建判定器与通知器、也不写配置文件。这个变量由 `pi-subagents` 的后台 runner 在加载扩展之前写入（`pi-subagents/src/runs/background/subagent-runner.js` 执行 `process.env.PI_SUBAGENT_CHILD = "1"`，常量在 `src/runs/shared/child-runtime-config.js`），`pi-subagents` 自己的入口也用同一个变量短路注册。

原因不是「子代理不需要保护」，而是**当前的 Pi 与 pi-subagents 都没有一条「子会话向人求确认」的通道**——而这恰恰是子代理最需要确认的场景。后台 runner 里没有界面，dcg 判危的命令只能走 `headless` 分支，默认 `deny`，于是命令被直接拒绝，子代理的工作因此中断。

证据（基线 Pi 0.87.1 / pi-subagents 0.73.1 / pi-guard 0.5.0，完整报告见 `docs/research/subagent-guard-confirmation.md`，原始取证见同目录两份 `evidence-pi-*.md`）：

- Pi 只有 `tui | rpc | json | print` 四种扩展模式，`hasUI` 的判定是「注入的 `uiContext` 是否为内置 no-op」；不存在 `requestApproval` / `escalate` 一类的确认上抛 API，官方约定是扩展自己用 `ctx.hasUI` 降级。
- 前台与后台子会话走同一段创建代码，都只调用 `bindExtensions({ mode: "print" })` 且不传 `uiContext`（`pi-subagents/src/runs/shared/child-session.js`，全包仅此一处）。扩展拿不到 `session`，无法自行改变这一点。
- `pi-subagents` 的 watchdog 权限仲裁是**模型**仲裁：其文档写明它只返回 approve/deny 且「does not notify the parent」，并拒绝 bash 规则、把命令级策略指向 pi-guard；向父会话转发前台 `ask` 请求「remains unsupported until the extension accepts a session-scoped target」。
- 生态里确实有第三方扩展声称实现了「子代理 ask 上抛父会话 UI 并排队」，但它绑定自己的 subagents 生态，依赖的子会话公告 seam 在 `pi-subagents` 里未确证存在，本机也没有安装该扩展。

## Considered Options

- **自建确认通道**（父侧确认服务 + 子侧请求客户端：前台走进程内 UI 代理，后台走跨进程往返）。否决理由：这是 pi-guard 之外的一整层协调机制，需要改 pi-subagents 或复刻它的事件/文件协议，而父会话不在时机制本身就没有接收方；在拿到上游支持之前不划算。
- **子代理内把 `headless` 强制为 `allow`**。否决理由：仍然要为每个 bash 调用 spawn 一次 dcg（含 2 秒超时窗口）却从不拦截，是纯粹的延迟成本，还让「判定器不可用时 fail-safe 拒绝」这条语义在两种会话里变得不一致。
- **加一个 `subagents: skip | guard` 配置项**。否决理由：默认值只可能是 skip，配置面、文档与校验分支都要为一个几乎没人会改的开关而存在。
- **不用环境变量，自己检测会话类型后跳过**。否决理由：前台子会话在父进程内、没有任何进程级标记，只能依赖会话文件路径之类的间接信号，可靠性更低。

## 不可静默更改的不变量

1. **早退必须发生在任何副作用之前。** 检测放在工厂第一行：子代理进程里不写 `guard.json`、不 spawn dcg、不发通知；否则「不生效」只是不拦截，文件与进程副作用仍然存在。
2. **检测信号固定用 `PI_SUBAGENT_CHILD === "1"`，不要换成别的启发式。** 它是 pi-subagents 自己在子进程里短路注册用的同一个变量，并且在扩展加载之前写入；任何基于 cwd、会话路径或 agent 名的判断都会误伤主会话。
3. **前台子代理里显式列出 pi-guard 仍然生效。** `extensions` / `subagentOnlyExtensions` 的显式列举是使用者的明确要求，不是意外加载；要连同它一起跳过，先得有可靠的会话识别手段（见上）。
4. **不要把「子代理不生效」当成安全性下降而「顺手修复」。** 真正的修复是拿到一条子会话到人的确认通道，那属于上游能力，不应在本仓库里静默发明。

## Consequences

- 后台子代理不再因为 dcg 判危而被直接拒绝，长任务不会再被一条命令打断。
- 子代理里的命令级保护在安装 pi-guard 后依然为零：`bash` 层面的策略在主会话之外没有执行点，需要更强隔离时应使用容器或 OS 沙箱。
- 这条边界写进 `README.md` 的 Boundaries；`pi-subagents` 自己的文档也把命令级策略指向 pi-guard，两边说明需要保持同步。

> 实现状态：已实现（`plugins/pi-guard/src/subagents.ts` 的标记判定、`src/index.ts` 工厂首行早退、`test/index.test.ts` 的「子代理内不注册 / 主会话内注册」回归测试，README 与 changeset 同步）。
> 证据来源：`docs/research/subagent-guard-confirmation.md`、`docs/research/evidence-pi-subagents-child-guard-seams.md`、`docs/research/evidence-pi-child-session-ui-api.md`

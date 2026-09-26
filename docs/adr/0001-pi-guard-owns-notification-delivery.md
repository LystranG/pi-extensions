---
status: accepted
---

# pi-guard 自己负责把通知送到用户手上，不外包给事件总线

`@lystran/pi-guard` 在危险命令确认框弹出前自己投递通知：在 tmux 或 GNU screen 里直接写终端 BEL（多路复用器会把它变成状态栏的窗口提醒，并按 `visual-bell` 的设置透传给外层终端），否则先尝试终端级 OSC 序列，再走 spawn 系统通知进程的降级链，最后兜底写一个 BEL。之所以不把「危险命令待确认」发布到 `pi.events` 交给第三方通知插件消费、也不依赖宿主已有的 `ui_prompt_start` 事件，是因为这是一个安全插件：**装了就有效** 优先于职责分离。生态证据也不支持外包——唯一订阅 `rpiv:ask-user:prompt` 的通知插件默认关闭，`rpiv:ask-user:blocked` 至今零消费者；而 Pi 上游明确拒绝把通知能力做进核心（PR #462 被拒、issue #5788 标 `NOT_PLANNED`，只合并了 OSC 777 示例扩展）。

> 实现状态：已实现（`plugins/pi-guard/src/notify.ts` 的终端 OSC 前置层、多路复用器走 BEL 的分支、BEL 的 `isTTY` 门控，测试与 README、changeset 同步）。
> 证据来源：`docs/research/pi-notification-delivery-api.md`、`docs/research/rpiv-ask-user-question-attention-signals.md`、`docs/research/pi-guard-terminal-notification-library-survey.md`

## Considered Options

这些方案都是带着证据否掉的，写在这里是因为它们看起来都合理，半年后一定还会被重新提出来。

- **只发公开事件，交给生态**（`@gotgenes/pi-permission-system` 的做法，把 `permissions:ui_prompt` 广播给通知插件）。否决理由：无人订阅就是静默失效，而默认安装的用户正是最需要保护的那批人。生态里订阅 `ui_prompt_start` 的插件确实存在（`@yuru7/pi-native-notify` 等，已验证源码），但依赖用户额外安装不该是安全插件的默认路径。
- **什么都不做，靠宿主 `ui_prompt_start` + 用户自装插件**。否决理由同上；另外它是**全局**事件，任何扩展的弹窗都会触发，pi-guard 无法只在自己的审批框上通知。
- **双轨：自带兜底 + 额外发事件**。否决理由：pi-guard 会与订阅 `ui_prompt_start` 的插件对同一次确认发两次通知，而 Pi 的 `EventBus` 只有 `emit` / `on`，没有「有没有人在听」的查询能力，抑制机制无处落地。
- **用 `node-notifier` 替换手写的 spawn 降级链**。否决理由：它 2022-02 之后再无发版，带 6 个运行时依赖与 5.68 MB 解包（其中约 4.8 MB 是 Windows 二进制，而 Windows 已明确不纳入 toast），包内 3 份第三方 LICENSE，`execFile` 未传 timeout，且没有逐级降级与退出码判定——换来的只有「API 简洁 + macOS 免装 terminal-notifier」。保持零运行时依赖。
- **支持 tmux（DCS passthrough）**。否决理由见下「不可静默更改的不变量」。
- **tmux/screen 里只走 spawn 系统通知链**（0.4.0 的行为）。否决理由：`osascript display notification` 只要语法正确就返回 0，于是链路自称「已送达」，而 BEL 又被「只在全部候选失败时才响」这个条件挡住——结果在 tmux 里最好的情况是一条署名脚本编辑器的横幅，最坏是什么都没有。BEL 是这一层唯一有确定反馈的通道。
- **用 `tui.terminal.write()` 或 `/dev/tty` 代替 `process.stdout.write`**。否决理由：`tui.terminal.write` 的字节落点与写 stdout 完全相同，不解决与渲染管线的竞争，还多出组件挂载/卸载与 `/reload` 的生命周期；`/dev/tty` 丢掉 `isTTY` 语义，远端宿主自己渲染 UI 时也会被写到。选择 `process.stdout.write` + `isTTY` 门控，与上游示例和 `rpiv-ask-user-question` 一致。

## 不可静默更改的不变量

这几条不是取舍，是「不知道就会写错、而且错了不会报错」的那类约束。改动前请先读这里。

1. **排除 tmux/screen 必须查 `TMUX` / `STY` 环境变量本身，不能只靠 `TERM_PROGRAM`。** tmux 3.3 起把 `TERM_PROGRAM` 覆写为 `tmux`，但**不清洗** `KITTY_WINDOW_ID` / `ITERM_SESSION_ID` / `GHOSTTY_RESOURCES_DIR` / `WT_SESSION`，这些会原样幸存。若只按 `TERM_PROGRAM` 判断，「外层 kitty + 内层 tmux」会命中白名单、写出被 tmux 静默丢弃的 OSC，而由于「命中即跳过 spawn 链」，用户会一条通知都收不到。这是本方案最坏的失败路径。
2. **OSC 探测命中后跳过 spawn 链，是有意放弃失败可探测性。** 白名单是这个方案唯一的保护：终端一旦改变行为，用户会静默收不到通知。不要在未重新评估这条代价的情况下把它改成「两条都发」或反过来。
3. **写 OSC 前必须先清理控制字符，顺序是「先清理 → 再拼序列」。** `notify.includeCommand` 为 true 时正文含模型生成的命令文本，其中任何一个 `ESC` 或 `BEL` 都能提前终结序列、注入任意转义序列。反序（先拼再清理）会在需要 tmux 包装时把用于 ESC 翻倍的字节一起清掉。
4. **多路复用器里 BEL 是投递通道，不是兜底。** `TMUX`/`STY` 命中时直接写 BEL 并跳过 spawn 链，不要「先 spawn 再兜底响铃」——那会让同一次确认既点亮窗口旗标、又弹一条系统横幅。`bell: false` 时不占用这条通道，继续走系统通知链，避免一个开关让安全插件彻底静默。
5. **`TMUX` 存在时不要试图用 DCS passthrough 绕过。** 它要求用户配 `allow-passthrough`（默认 off），而 `on` 对**不可见 pane 不生效**——恰好就是「用户切走了、需要通知」这个场景；要覆盖得配 `all`。另外 tmux 的 `update-environment` 不含任何终端身份变量，reattach 后检测会指向旧终端。

## Consequences

- **tmux/screen 用户不再收到系统横幅**（那是被主动跳过的）：他们得到的是状态栏的窗口旗标，加上外层终端的 bell 通知。外层终端若关掉了 bell 通知（iTerm2 的 `BM Growl`、终端自身的静音 bell 等），就只剩旗标——那正是 tmux 用户本来就在用的提醒方式。
- **本机（开发机）就在 tmux 里**，因此 OSC 层在本机永远不会触发，端到端效果无法在本地验证。单测只能证明字节正确，证明不了「终端真的弹了通知」。任何声称验证过的说法都必须在非 tmux 环境下复现。
- **OSC 与 Pi TUI 的差量渲染 + `CSI 2026` 原子帧是否存在竞争，尚未实测**（验证方式：设 `PI_TUI_WRITE_LOG` 抓原始字节流比对帧边界）。选 `process.stdout.write` 意味着这个风险原样保留。
- **覆盖率确实变窄**：支持 OSC 通知的只有 kitty / Ghostty / WezTerm / iTerm2 / rxvt-unicode / Warp；VS Code 集成终端（xterm.js 官方序列表里没有 9/99/777）、Windows Terminal（777 默认关闭）、Apple Terminal、Alacritty 都退回 spawn 链；tmux/screen 用户改走 BEL 通道（见不变量 4），只有 `bell: false` 时才会退回 spawn 链。这不是功能回归，但预期要与用户说明。
- **`notify.enabled` 与现有 `minIntervalMs` / `maxPerMinute` 节流同时约束 OSC 层**，不新增配置项；没有 `notify.terminal: auto|off` 这类第三态。
- 保持零运行时依赖：新增代码全部进 `plugins/pi-guard/src/notify.ts`，`package.json` 不新增 `dependencies`。

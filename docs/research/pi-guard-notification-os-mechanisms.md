# 调研：Node.js 20+ CLI/TUI 应用在等待用户输入时触发操作系统级通知的跨平台机制

> 目标读者：`pi-guard` 插件维护者。用途：为"危险命令确认框出现时弹出系统级通知"做技术选型。
> 调研日期：2026-09（本报告中所有"截至今日"均指该日期）。
> 证据分级约定：**文档已证实** = 官方文档/规范/源码/man page 原文；**社区证据** = 论坛、issue、第三方 README 等真实用户报告；**推断** = 由已证实事实推导，无直接来源；**待验证** = 无法从来源确认，需要实测。

---

## Summary

在 Pi 插件里**不应该**自己往终端写 OSC 转义序列（`OSC 9/777/99`）来触发通知：Pi 的 TUI 采用差量渲染 + CSI 2026 同步输出，且**没有暴露任何写转义序列的公开 API**，直写 `stdout` 会与渲染管线竞争并污染非 TUI 模式的输出（Claude Code 正是为此设计了由宿主代写的 `terminalSequence` 字段，并明确说明 hook 直接写 `/dev/tty` 会失败）。**推荐做法是启动一个独立的系统通知进程**（macOS: `terminal-notifier` → 退化为 `osascript`；Linux: `notify-send` → 退化为 `gdbus call`；Windows: 默认只响铃/发声，toast 作为可选 opt-in），一律用 `spawn(bin, argv)` 传参、`detached + stdio:"ignore" + unref` 非阻塞执行、失败静默降级，并对通知做去重与节流。**焦点感知不做主动探测**，默认"总是通知"，把"仅在未聚焦时通知"交给终端自身（Ghostty / WezTerm / Windows Terminal 都已内建该能力）。

---

## 0. 本地前置事实（以本机公开 API 为准）

仓库约束（`AGENTS.md`）：Node.js `>=20`、ESM、直接发布 TS、生产代码禁止 Bun 专有 API、Node 内置模块用 `node:` 前缀、运行时依赖写入插件自己的 `dependencies`、测试不得访问真实网络。
本地 `@earendil-works/pi-coding-agent@0.84.2` 的 `package.json` 声明 `engines.node >= 22.19.0`（`plugins/pi-guard/node_modules/@earendil-works/pi-coding-agent/package.json`），而插件自身声明 `>=20`；因此**所选用的 Node API 必须存在于 Node 20**（`spawn` 的 `detached`/`unref`/`stdio`/`windowsHide`/`timeout` 均满足）。

Pi 暴露给插件的 UI 能力（本机类型定义 `plugins/pi-guard/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`，公开入口 `dist/index.d.ts` 再导出）：

| 能力 | 签名 | 对本次选型的含义 | 证据 |
|---|---|---|---|
| 确认框 | `ctx.ui.confirm(title, message, opts?: {signal?, timeout?})` | 通知的触发点；`timeout` 会让对话框倒计时自动消失 | 文档已证实（本地 d.ts） |
| 应用内通知 | `ctx.ui.notify(message, type?: "info"\|"warning"\|"error")` | **只是 TUI 内部提示，不是系统通知** | 文档已证实（本地 d.ts） |
| 模式 | `ctx.mode: "tui" \| "rpc" \| "json" \| "print"`；`ctx.hasUI: boolean` | 只有 `tui` 模式才值得发系统通知 | 文档已证实（本地 d.ts） |
| 终端原始输入 | `ctx.ui.onTerminalInput(handler): () => void` | **只有输入方向**，可用来接收焦点事件（`CSI I`/`CSI O`），但 Pi 未暴露"开启 DECSET 1004 焦点上报"的开关 | 文档已证实（本地 d.ts，注释写明 "Listen to raw terminal input (interactive mode only)"） |
| 终端标题 | `ctx.ui.setTitle(title: string): void` | 说明 Pi 内部有写 OSC 的能力，但只暴露标题这一个用途 | 文档已证实（本地 d.ts） |

**结论（推断）**：Pi 插件**没有**写任意转义序列的公开 API；任何 OSC 通知方案都必须绕过 TUI 直接写 `process.stdout` 或 `/dev/tty`，这正是 D 节判定为高风险的原因。

TUI 渲染机制（`@earendil-works/pi-tui` README，`https://github.com/earendil-works/pi/blob/main/packages/tui/README.md`）：**差量渲染（只更新变化行）+ 同步输出 `CSI 2026`（`\x1b[?2026h` … `\x1b[?2026l`）**；每行末尾追加完整 SGR reset 与 OSC 8 reset；组件 `render(width)` 返回行数组，行宽超限即报错。

---

## A. macOS

### A1. `osascript -e 'display notification ...'`

**语法（文档已证实）**：Apple 官方 Mac Automation Scripting Guide 给出
`display notification "All graphics have been converted." with title "My Graphic Processing Script" subtitle "Processing is complete." sound name "Frog"`
即 `title` / `subtitle` / `sound name` 均为可选参数。
来源：https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/DisplayNotifications.html

**转义规则（文档已证实）**：AppleScript 官方 `text` 类参考的 "Special String Characters" 一节明确：

> The backslash (`\`) and double-quote (`"`) characters have special meaning in text. … if you want to include an actual backslash or double-quote character in a `text` object, you must use the equivalent two-character sequence.

并给出对照表：`\` → `\\`，`"` → `\"`，另有 `quote` 常量等于 `"`；`\r`（return）、`\t`（tab）、`\n`（linefeed）是转义序列。
来源：https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_classes.html

**语句是单行的（文档已证实）**：同一语言指南指出 "A simple AppleScript statement must normally be entered on a single line"，`-e` 的每一行是一条语句。
来源：https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/conceptual/ASLR_lexical_conventions.html

→ **推断（重要）**：把用户/AI 生成的命令文本直接插进 `"..."` 字面量是**语言级注入面**：文本里的 `"` 会提前闭合字面量，文本里的裸换行会把一条语句拆成两条（可注入任意 AppleScript 语句，例如 `do shell script ...`）。这不是 shell 注入（因为我们不经 shell），但同样是注入。必须做 `\` → `\\`、`"` → `\"` 的转义，并把 CR/LF/TAB 与其他 C0 控制字符替换掉（顺序：先转义反斜杠，再转义引号）。

**更好的做法：完全不插值（文档已证实）**：`osascript(1)` man page 原文：

> Any arguments following the script will be passed as a list of strings to the direct parameter of the `run` handler.
> `on run argv` / `return "hello, " & item 1 of argv & "."` / `% osascript a.scpt world` → `hello, world.`

来源：https://www.unix.com/man_page/osx/1/osascript （man page 镜像；man page 为第一手文档）
→ 可写成 `osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title (item 2 of argv)' -e 'end run' <msg> <title>`，让文本以 argv 形式进入 AppleScript，**从根本上消除插值注入**。
**待验证**：man page 的示例用的是"脚本文件名 + 参数"形式；`-e` 形式下参数是否会被 `run` handler 接收、以及是否需要 `--` 分隔符、参数以 `-` 开头时的行为，官方文档未明确，需实测。

**权限（社区证据，medium）**：macOS Sequoia 上，`osascript -e 'display notification ...'` 在 Terminal 中**不显示**，直到用户先在 **Script Editor** 中运行一次 `display notification` 并允许其通知权限；用户报告"期望是 Terminal 请求权限，实际是 Script Editor"。即该通知被归属到 **Script Editor / AppleScript 运行时**，而非调用它的终端。
来源：https://www.macscripter.net/t/trying-to-use-terminal-for-display-notification/76593
**矛盾**：`pi-chime` 的 README 声称 "The banner is sent via `osascript`, which inherits the notification sandbox of the calling terminal process"（即归属终端）。两者冲突，见"矛盾点"。
来源（第三方 README）：https://pi.dev/packages/pi-chime

**非 GUI / SSH 行为（文档已证实，间接但强）**：`terminal-notifier` 的官方 README 在"When notifications do not appear"中写明：

> **No GUI session.** Notifications belong to a logged-in user, so they cannot be posted over SSH or from a launchd daemon running as root.

来源：https://github.com/julienXX/terminal-notifier
→ 推断：同一限制适用于 `display notification`（都走用户级通知中心）。SSH/无 GUI 会话下应视为"不可用"，插件必须静默降级。

### A2. `terminal-notifier`

**事实（文档已证实）**：

- 用途：`terminal-notifier -title 'Build' -message 'Finished in 42s' -sound default`；"Requires macOS 10.14 or higher"。
- **需要额外安装**：`brew install terminal-notifier`，或从 releases 下载预编译产物，或 `make install`。
- **Gatekeeper 摩擦**：README 明确 "terminal-notifier is not notarized … macOS quarantines anything you download so the first run is blocked"，下载版需要 `xattr -dr com.apple.quarantine`；Homebrew 与 `make install` 不受影响。
- **参数传递方式**：纯 argv 选项（`-message`/`-title`/`-subtitle`/`-sound`/`-group`/`-open`/`-execute`/`-activate`/`-remove`/`-list`/`-diagnose`/`-timeout`/`-action`），**不需要拼任何脚本语言**。
- **属性怪癖**：选项值经 `NSUserDefaults` 读取并会尝试按 property list 解析，**首字符是 `[`、`(`、`{`、`"` 等会被误读导致通知不发**，需要加反斜杠转义（"Only the first character ever needs this"）。→ 与 pi-guard 高度相关：命令文本常以 `[`、`(`、`{` 开头（例如 `{ ... }`、`[...]`）。**这是 terminal-notifier 自身的一个真实可用性坑**。
- **通知归属**：以 app bundle 形式发布，"A notification is attributed to an application"；每个副本有自己的 bundle id 与独立权限条目。
- **诊断与退出码**：`-diagnose` 报告授权状态、alert style、声音、Notification Center 是否运行、Scheduled Summary 是否压制；退出码 `3` = 未授权，`4` = 到达通知服务超时（通常是无 GUI 会话），`5` = 服务拒绝，`6` = `-timeout` 到期。
- **去重能力**：`-group ID` 使同组通知只保留一条（后发覆盖前发），README 直接给出 `$$`（按进程）或 `$PWD`（按项目）作为分组建议。
- **权限重置**：`tccutil reset UserNotification fr.julienxx.oss.terminal-notifier`。

来源：https://github.com/julienXX/terminal-notifier

**对比 osascript 的差异（推断，基于以上已证实事实）**：terminal-notifier 是 argv 工具，无脚本语言注入面、有 `-group` 去重、有结构化退出码与 `-diagnose`、支持点击激活/自定义按钮；代价是额外安装 + 未 notarize + 首字符 property list 怪癖。`osascript` 零安装、但注入面大、无去重、无退出码语义、权限归属到 Script Editor。

### A3. `afplay` / 系统提示音

- macOS 自带 `/usr/bin/afplay`，播放音频文件；`-v` 可调音量；默认播放完才退出（后台运行需 `&`）。
  来源（第三方参考，非官方）：https://ss64.com/mac/afplay.html
- **待验证**：Apple 没有为 `afplay` 发布公开的官方文档页（未找到 developer.apple.com 上的 man page），上述来源为第三方整理。
- 其他可替代的"只出声"手段：终端 BEL（`\x07`，见 D 节）；Ghostty 的 `bell-features` 支持 `system`/`audio`/`attention`/`title` 等（官方配置参考），`system` 项在 macOS 上播放系统提示音。
  来源：https://ghostty.org/docs/config/reference
- **定位（推断）**：声音**不是系统通知**，没有视觉持久性、没有通知中心记录；在用户戴耳机/静音/离开座位时无效。仅适合作为"系统通知不可用"时的最后一级降级。

### A4. 终端转义序列（OSC 9 / OSC 777 / OSC 99）

见 D 节统一评估。macOS 上相关事实：iTerm2 用 `OSC 9 ; [Message] ST` 发通知（官方文档），且 iTerm2 作者明确"有一个 per-profile 偏好可以关闭它"，OSC 9 内容"是 session 的编码（通常是 UTF-8）"，**没有 subtitle/icon**，且这是"早于我管理 iTerm 之前就存在的很老的控制序列"。
来源：https://iterm2.com/documentation-escape-codes.html 、https://github.com/kovidgoyal/kitty/issues/1474
注意冲突：iTerm2 的 `OSC 9 ; 4 ; ...` 是进度条，Ghostty 文档也提醒 OSC 9 通知的标题"不应以数字加 `;` 开头"，否则会与 ConEmu 扩展（OSC 9;n）冲突。
来源：https://ghostty.org/docs/vt/osc/9

### macOS 小节结论

| 方案 | 依赖 | 可靠性 | 主要失败模式 |
|---|---|---|---|
| `terminal-notifier` | 需安装（brew / 下载 / 编译） | **高**（argv、有诊断、有去重、有退出码） | 未安装（ENOENT）；未 notarize → Gatekeeper 拦截；未授权（exit 3）；无 GUI 会话/SSH（exit 4）；首字符是 `[({`" 被误解析 |
| `osascript display notification` | 零依赖（系统自带） | **中**（注入面大、权限归属怪、无诊断） | Script Editor 未授权 → 静默不显示；SSH/无 GUI → 不可用；未转义 → AppleScript 语法错误或注入 |
| `afplay` / BEL | 零依赖 | **低**（仅声音） | 静音/耳机/离开座位时完全无效；无视觉留存 |
| OSC 9 / 777（写终端） | 零依赖（但需终端支持 + Pi 无 API） | **低**（见 D） | 终端不支持则静默忽略；与 TUI 渲染竞争；tmux 需 passthrough |

---

## B. Linux

### B1. `notify-send` / libnotify

- `notify-send` 由 libnotify 提供（Debian/Ubuntu 包名 `libnotify-bin`）。
  来源（man page）：https://man.archlinux.org/man/notify-send.1.en 、https://manpages.debian.org/testing/libnotify-bin/notify-send.1.en.html
- 用法（文档已证实）：`notify-send [OPTIONS] {summary} [body]`。相关选项：`-a/--app-name`、`-u/--urgency=low|normal|critical`、`-t/--expire-time`、`-i/--icon`、`-c/--category`、`-h/--hint`、`-p/--print-id`、`-r/--replace-id`、`-w/--wait`、`-e/--transient`。
- **`-t` 不可靠（文档已证实）**：man page 原文 "Not all implementations use this parameter. GNOME Shell and Notify OSD always ignore it, while Plasma ignores it for notifications with the critical urgency level."
- **参数语义（源码已证实 + 文档已证实）**：`notify-send.c` 使用 `g_option_context_parse` + `G_OPTION_REMAINING`（`G_OPTION_ARG_FILENAME_ARRAY`）接收位置参数，即 `summary`/`body` 是"剩余参数"。
  来源（源码）：https://raw.githubusercontent.com/GNOME/libnotify/master/tools/notify-send.c
  GLib 官方文档对 `--` 的处理："A '—' option is stripped from `argv` unless there are unparsed options before and after it, or some of the options after it start with '-'."
  来源：https://docs.gtk.org/glib/method.OptionContext.parse.html
  → **推断**：`notify-send -- "$summary" "$body"` 一般可用，但 man page **没有**记录 `--`，且 GLib 文档对"`--` 之后仍有以 `-` 开头的参数"给出例外条款。**待验证**：以 `-` 开头的消息体/摘要的确切行为需实测；工程上更稳妥的是对以 `-` 开头的文本做前置空格处理（见 F）。
- **默认是否预装（社区证据 + 待验证）**：Ubuntu/Fedora 上常见 "notify-send: command not found"，需要 `apt install libnotify-bin` / `dnf install libnotify`。ArchWiki 把 `libnotify` 列为需安装的包。
  来源：https://forums.linuxmint.com/viewtopic.php?t=265690 、https://wiki.archlinux.org/title/Desktop_notifications 、https://packages.fedoraproject.org/pkgs/libnotify/libnotify
  → **不能假设存在**，必须处理 ENOENT。
- **需要通知服务器（文档已证实）**：ArchWiki 列出内置服务器（Cinnamon/Deepin/Enlightenment/GNOME/GNOME Flashback）与独立服务器（Dunst、fnott、mako、LXQt、MATE、notification-daemon、Notify OSD、statnot、swaync、twmn、wired、Xfce 等），并说明"在其他桌面环境中，通知服务器需要手动安装并通过 XDG Autostart 启动，或做成 D-Bus 服务以便首次调用时自动激活"。
  来源：https://wiki.archlinux.org/title/Desktop_notifications
- **失败方式（文档已证实）**：ArchWiki Troubleshooting "Applications hanging for exactly one minute"——当某个通知服务**虚假宣告**自己的 D-Bus 可用性时，调用方会挂起；日志示例 `Activated service 'org.freedesktop.Notifications' failed: Process org.freedesktop.Notifications exited with status 1`。
  → 对 pi-guard 的含义：**必须给子进程加超时并 SIGKILL**，否则一次通知可能挂住（虽然 detached 子进程不会阻塞主循环，但会留下僵尸等待）。
- **去重（文档已证实 + 部分）**：`-r/--replace-id` 需要知道 ID（`-p` 可打印 ID）；ArchWiki 指出 "notify-send does not report this ID, so alternative tools are required"，但对 **某些**服务器可用 `-h string:x-canonical-private-synchronous:<key>` 达到替换效果。
  来源：https://wiki.archlinux.org/title/Desktop_notifications

### B2. 直连 D-Bus（`org.freedesktop.Notifications`）

- 规范（文档已证实）：freedesktop Desktop Notifications Specification 定义 `Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout)` 方法，vendor 扩展以 `x-vendor` 前缀。
  来源：https://specifications.freedesktop.org/notification/latest/protocol.html
- 命令行可达方式（文档已证实）：`gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify ...`；或 `dbus-send`。
  来源：https://wiki.archlinux.org/title/Desktop_notifications 、https://docs.oracle.com/cd/E88353_01/html/E37839/gdbus-1.html
- **优点（推断）**：不依赖 `notify-send` 二进制，`gdbus` 随 glib2 提供（桌面发行版通常已有），可显式传 `replaces_id` 实现替换。
- **缺点（推断 + 待验证）**：需要会话总线（`DBUS_SESSION_BUS_ADDRESS`），SSH/无桌面时同样失败；`gdbus call` 的参数语法需要小心构造（GVariant 字面量），字符串里的引号需要按 GVariant 规则转义——**这是一个新的转义面**，必须实测。用 Node 纯 JS 的 D-Bus 客户端（如 `dbus-next`）可绕开 CLI 转义，但会给插件增加运行时依赖。
- **默认预装（推断）**：`dbus-send` 随 `dbus` 包，`gdbus` 随 `glib2`；几乎所有桌面发行版都有，但**不能假设**。

### B3. `zenity`

- `aider` 官方文档把 zenity 列为 Linux 的兜底通知方式之一（"Linux: Uses `notify-send` or `zenity` if available"）。
  来源：https://aider.chat/docs/usage/notifications.html
- **推断**：zenity 是 GTK 对话框工具，会弹出一个**需要用户点击的模态窗口**，不是通知中心气泡；需要 X/Wayland 显示。对"用户不在电脑前"的场景价值很低，且可能干扰 TUI（独立窗口抢占焦点）。不建议采用。

### B4. 无桌面环境（纯 SSH、WSL、headless）

- 无会话总线 / 无通知服务器时：`notify-send` 报连接失败（社区证据：需要设置 `DISPLAY`/`DBUS_SESSION_BUS_ADDRESS`，否则 "Failed to connect to socket"）。
  来源：https://forum.garudalinux.org/t/notify-send-not-showing-notifications/21449 、https://oneuptime.com/blog/post/2026-03-02-configure-desktop-notifications-ubuntu-server-headless/view
- **WSL 特例**：WSL 里默认**没有**桌面通知服务；`pi-notify` 的做法是在 `WT_SESSION` 存在时改走 Windows 侧 PowerShell toast（见 C）。
  来源：https://github.com/ferologics/pi-notify
- **结论（推断）**：Linux 侧必须把"通知失败"当作正常路径处理：不报错、不阻塞、不影响确认框本身。

### Linux 小节结论

| 方案 | 依赖 | 可靠性 | 主要失败模式 |
|---|---|---|---|
| `notify-send` | libnotify（`libnotify-bin`），常需手装 | **高**（桌面环境下） | ENOENT；无会话总线/SSH → 连接失败；无通知服务器 → 挂起或失败；`-t` 被部分服务器忽略 |
| `gdbus call`（D-Bus 直连） | glib2（`gdbus`） | **中高** | ENOENT；无会话总线；GVariant 参数转义需实测 |
| `zenity` | zenity + X/Wayland | **低** | 模态窗口抢焦点、干扰 TUI；无显示则失败 |
| OSC 777（写终端） | 终端支持（见 D） | **低** | 见 D 节 |

---

## C. Windows 与 WSL

### C1. PowerShell toast（WinRT）

- **API 事实（文档已证实）**：`ToastNotificationManager.CreateToastNotifier()` 的 Remarks 明确：

  > Do not use this overload when creating a toast notifier for a desktop app. Use `CreateToastNotifier(appID)` to supply the required **AppUserModelID**.

  来源：https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotificationmanager.createtoastnotifier?view=winrt-28000
- → **推断**：从 PowerShell/CLI 发 toast 需要提供一个已注册的 AppUserModelID（AUMID）。**BurntToast 模块不是协议上必需的**，它只是把这个流程封装好；但"完全不用任何封装"意味着要自己选一个已存在的 AUMID 并处理打包/未打包差异（Windows Terminal 自己的 PR 里也踩过"packaged 与否"的坑，见下）。
  来源（BurntToast 用法，第三方）：https://www.pdq.com/blog/display-toast-notifications-with-powershell-burnt-toast-module
- **真实案例（社区证据，high 相关性）**：Codex CLI 在 WSL 下用 `wsl.exe → powershell.exe -NoProfile -NoLogo -EncodedCommand ...` 构造 `Windows.UI.Notifications.ToastNotificationManager` toast（title/body 走 base64），**在企业环境中触发了 EDR 告警**，报告者称该机制"extremely malware-shaped"（PowerShell + EncodedCommand + 从 WSL 启动）。
  来源：https://community.openai.com/t/codex-cli-on-windows-wsl-triggers-edr-alert-due-to-powershell-encodedcommand-toast-notifications/1375803
  → **对 pi-guard 的强含义**：pi-guard 是安全插件，若在 Windows/WSL 上用 PowerShell + `-EncodedCommand` 发 toast，会让安全插件自己成为 EDR 告警源，且难以自证清白。**建议默认不做 Windows toast**，或至少不使用 `-EncodedCommand`、把开关交给用户显式 opt-in 并在 README 说明。
- **待验证**：不使用 `-EncodedCommand` 时，如何在 PowerShell 里安全地把任意文本作为 toast body 传递（`-Command` 仍有引号转义问题；`-File` + 临时文件会引入文件写入与清理成本）；以及未打包进程可用的稳定 AUMID 具体是哪一个。

### C2. `msg` 命令

- **文档已证实**：`msg` 是"向远程桌面会话主机（RDS）服务器上的用户发送消息"，且"You must have Message special access permission to send a message"；`<message>` 作为位置参数，`/time` 默认 60 秒后消失，`/w` 等待确认。
  来源：https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msg
- → **推断**：`msg` 面向 RDS 场景，需要特殊访问权限，不是面向普通桌面单机用户的通知机制；且会弹出一个必须确认/会超时的消息框。**不建议采用**。

### C3. Windows Terminal 的 OSC 777

- **状态（源码/PR 已证实）**：microsoft/terminal issue **#7718 "Send Desktop Notification via VT Sequence (OSC777)"** 于 **2026-06-04** 被 **CLOSED (COMPLETED)**，由 PR **#20012**（title: "Add support for OSC777 (Send Notification)"，**MERGED 2026-06-04**）关闭。
  PR 描述原文：

  > This adds support for the `OSC 777 ; notify ; title ; body ST` sequence. This allows client applications to send a notification to the Terminal. When this notification is clicked, it summons the terminal window that sent it.

  来源：https://github.com/microsoft/terminal/issues/7718 、https://github.com/microsoft/terminal/pull/20012
- **默认关闭（源码/PR 评论已证实）**：bug bash 反馈 "should be disabled by default"，作者回复 "Updated default to `false`. Validated that this works."；PR 改动了 `doc/cascadia/profiles.schema.json`（+5/−0）新增一个 profile 级设置。**待验证**：该设置的确切 JSON 键名与开启方法（PR 的 "Documentation updated" 复选框为未勾选）。
- **聚焦时抑制（源码已证实）**：PR 提交历史含 `b53ccb8 Suppress notification if focused; add pane data` → Windows Terminal 自身在窗口聚焦时不弹通知。
- **版本可用性（待验证）**：Windows Terminal Preview 1.24 与 1.25 的官方发布博客中**均未出现** OSC 777/notification/toast 相关字样（已检索原文）；PR 合入 `main`（2026-06-04），有用户在 issue 中表示"在 canary 构建上工作正常"。**具体进入哪个稳定版本文档未确认。**
  来源：https://devblogs.microsoft.com/commandline/windows-terminal-preview-1-24-release/ 、https://devblogs.microsoft.com/commandline/windows-terminal-preview-1-25-release/
- 历史背景（文档已证实）：2020 年 WT 团队曾以"不想让世界更吵"为由倾向不实现，后来因为 SSH 场景的互操作需求而接受 PR。同一 issue 里 j4james 提到"我个人只输出一个 BEL 也能凑合"。
  来源：https://github.com/microsoft/terminal/issues/7718

### C4. WSL 里通过 interop 调用 `powershell.exe`

- **机制（文档已证实）**：WSL 默认把 Windows 路径追加到 Linux `PATH`，因此可直接调用 `powershell.exe`；`.exe` 后缀必需，"without it, the shell looks for a Linux binary"。
  来源：https://devblogs.microsoft.com/commandline/interop-between-windows-and-bash/ 、https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop
- **失败模式（文档已证实）**：
  - `/etc/wsl.conf` 的 `[interop] enabled`（默认 `true`）：设为 `false` 时"block the launch of Windows processes"。
  - `[interop] appendWindowsPath`（默认 `true`）：设为 `false` 时 Windows 路径不进入 `PATH`，`powershell.exe` 无法按名调用（需要绝对路径，例如 `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`）。
  - MS Learn 明确提示："Do not assume WSL is present — always check before calling `wsl.exe` or accessing `\\wsl$\` paths."
  来源：https://learn.microsoft.com/en-us/windows/wsl/wsl-config 、https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop
- **其他失败模式（社区证据）**：WSL interop 服务失联（`WSL_INTEROP` 指向失效的 interop server）导致"Windows 与 WSL2 停止通信"，需要重启 WSL。
  来源：https://www.blogbyben.com/2022/02/gotcha-when-windows-and-wsl2-stop.html
- **EDR 风险**：见 C1。
- **待验证**：`WT_SESSION` 环境变量是否在 WSL 内可见（`pi-notify` 用它判断"在 Windows Terminal 里"，但未找到微软官方文档定义该变量在 WSL 内的传递行为）。

### Windows 小节结论

| 方案 | 依赖 | 可靠性 | 主要失败模式 |
|---|---|---|---|
| PowerShell + WinRT toast | PowerShell + 已注册 AUMID（BurntToast 非必需但省事） | **中** | AUMID 缺失/未打包差异；**EDR 误报**；命令/文本转义复杂 |
| WSL → `powershell.exe` | WSL interop + Windows PATH | **中低** | interop 被禁用；`appendWindowsPath=false`；interop 服务失联；EDR 告警；跨边界延迟 |
| `msg` | RDS 特殊权限 | **低** | 无权限；面向 RDS；弹出需确认的窗口 |
| Windows Terminal OSC 777 | WT（canary/新版本）+ 用户开启 profile 设置 | **中**（默认关闭） | 版本未确认；默认 disabled；聚焦时被抑制；插件无法写 OSC（见 D） |
| BEL / 终端响铃 | 无 | **低** | 仅声音；用户可能关闭了终端响铃 |

---

## D. 终端转义序列方案是否安全（重点）

### D1. 支持矩阵（以官方文档为准）

| 终端 | OSC 9 | OSC 777 | OSC 99 | 来源 |
|---|---|---|---|---|
| iTerm2 | ✅ `OSC 9 ; [Message] ST` | ❌ | ❌ | https://iterm2.com/documentation-escape-codes.html |
| WezTerm | ✅ "iTerm2 Show System Notification / Show a toast notification" | ✅ `\e]777;notify;title;body\e\\`（"Only the notify extension is supported"） | ❌ | https://wezterm.org/escape-sequences.html |
| Ghostty | ✅ | ✅ 配置项说明："applications running in the terminal can show desktop notifications using certain escape sequences such as OSC 9 or OSC 777"，**默认 true** | ❌（讨论中，见下） | https://ghostty.org/docs/vt/osc/9 、https://ghostty.org/docs/config/reference |
| kitty | ✅（向后兼容，2020-08 加入） | ❌ 作者明确拒绝 | ✅ `OSC 99 ; metadata ; payload ST`（含 title/body 分块、Base64、点击回传、应用名/类型过滤） | https://sw.kovidgoyal.net/kitty/desktop-notifications/ 、https://github.com/kovidgoyal/kitty/issues/1474 |
| Windows Terminal | ✅（按 Claude Code 文档口径；`OSC 9;4` 为进度条） | ✅ **默认关闭**，PR #20012 合入 main | ❌ | https://github.com/microsoft/terminal/pull/20012 |
| Alacritty | ❌（pi-notify 支持表标 ✗；OSC 9;4 请求被 wontfix） | ❌ | ❌ | https://pi.dev/packages/pi-notify 、https://github.com/alacritty/alacritty/issues/5201 |
| macOS Terminal.app | ❌（pi-notify 支持表标 ✗） | ❌ | ❌ | https://pi.dev/packages/pi-notify |
| tmux | 需 passthrough | 需 passthrough | 需 passthrough | 见 D2 |

- **tmux 依赖（文档已证实）**：`allow-passthrough` 是 **pane 选项**（`on` | `off` | `all`）："Allow programs in the pane to bypass **tmux** using a terminal escape sequence (`\ePtmux;...\e\\`). If set to `on`, passthrough sequences will be allowed only if the pane is visible. If set to `all`, they will be allowed even if the pane is invisible." **默认值为 off**（man page 未列出默认 on）。
  来源：https://man7.org/linux/man-pages/man1/tmux.1.html
  → 用户必须自己配置 `set -g allow-passthrough on`，且 pane 不可见时 `on` 不生效。`pi-notify` 与 `pi-chime` 都确认这一点，并注明 zellij/screen 不支持。
  来源：https://pi.dev/packages/pi-notify
- **其他坑**：OSC 9 与 ConEmu 扩展（`OSC 9;n`）冲突，Ghostty 文档建议通知标题"不应以数字加 `;` 开头"；Ghostty 还会把无效的 ConEmu 序列静默转成 OSC 9 通知。
  来源：https://ghostty.org/docs/vt/osc/9

### D2. 在 Pi 这种全屏差量渲染 TUI 里直写 stdout 的风险

**风险 1：与渲染管线竞争（推断，基于已证实的渲染机制 + 已证实的行业实践）**
`pi-tui` 用 `CSI 2026` 同步输出把整帧包起来，并做行级差量更新；行尾还会追加 SGR reset 与 OSC 8 reset。插件在**帧中间**插入一个独立的 OSC 字节串，虽然终端会把它当零宽控制序列处理（不占格子），但：
- 若写入被拆成多次 `write()` 并与 TUI 的输出交错，OCS 序列可能被撕裂（例如 TUI 的 reset 字节插进 OSC 参数里），最坏情况是终端把后续可见文本吞进 OSC 直到遇到终止符 → **屏幕错乱**；
- 无法参与 `CSI 2026` 的原子帧，理论上存在闪烁/局部重绘异常。
**这不是纯理论**：Claude Code 官方 hooks 文档明确说明 hook 直接写 `/dev/tty` 行不通，且要求由宿主代写：
> Hooks run without a controlling terminal, so writing escape sequences directly to `/dev/tty` fails. Instead, return the escape sequence in the `terminalSequence` field and Claude Code emits it for you through its own terminal write path. **This is race-free**, works inside tmux and GNU screen, and works on Windows where there is no `/dev/tty`.
来源：https://code.claude.com/docs/en/hooks

**风险 2：非 TUI 模式污染输出（文档已证实 + 推断）**
`ctx.mode` 可能是 `rpc` / `json` / `print`（本地 d.ts）。这些模式下 stdout 是**数据通道**（JSON 流/打印结果），写入 ESC 字节会破坏下游解析器。Claude Code 同样把 `terminalSequence` 限制为"仅在交互式会话且界面在屏时生效，`-p`/SDK 下忽略"。
来源：https://code.claude.com/docs/en/hooks

**风险 3：Pi 没有提供安全通道（文档已证实，本地）**
`ExtensionUIContext` 只暴露 `setTitle`、`notify`、`onTerminalInput`、`custom` 等；没有 `writeEscapeSequence`/`terminalSequence` 之类的 API。绕过它只能用 `process.stdout.write` 或 `fs.openSync('/dev/tty','w')`，两者都会破坏上一条前提；而 Windows 上根本没有 `/dev/tty`。

**风险 4：可用性依赖终端 + 用户配置（文档已证实）**
如 D1：Terminal.app / Alacritty 完全不支持；tmux 需手动开 passthrough 且 pane 不可见时失效；WT 的 OSC 777 默认关闭；iTerm2 有 per-profile 开关可以关掉 OSC 9。

**风险 5：无法获得失败反馈（推断）**
写转义序列是 fire-and-forget，终端不支持时静默忽略，插件无法知道通知是否真的出现，也就无法降级到系统通知。

### D3. 结论

> **明确结论：不推荐在 pi-guard 插件里采用终端转义序列方案。**
>
> 理由：(1) Pi 没有公开 API 写转义序列，只能与 TUI 渲染管线竞争；(2) 会污染 `print`/`json`/`rpc` 模式的数据通道；(3) 覆盖终端有限且默认关闭/需用户配置；(4) 失败无反馈，无法降级。行业最佳实践（Claude Code）也是把转义序列交给**宿主**代写，而不是让扩展直接写终端。
>
> **可接受的例外**：把 BEL（`\x07`）作为**最后一级**的"响铃"降级手段——它是单字节、所有终端都支持、且不会撕裂 OSC 参数（但仍属写 stdout，需在 `mode === "tui"` 且写入是单次原子 `write()` 的前提下使用）。若将来 Pi 暴露"由宿主代写转义序列"的 API（类似 `terminalSequence`），再重新评估 OSC 9/99/777。

---

## E. 焦点感知（"只在未聚焦时通知"）

### E1. 各平台可行手段与成本

| 平台 | 手段 | 可行性 | 成本/不确定性 | 来源 |
|---|---|---|---|---|
| 终端原生（最佳） | Ghostty `command-finished-notification` = `never`/`unfocused`/`always`（默认 `never`），通知方式可选 `bell`/`notify`（`notify` 默认关闭）；另有 `bell-features` 的 `attention`（未聚焦时请求注意，macOS 上弹 dock 图标） | ✅ 终端自己做 | 需要用户配置；插件无法控制 | https://ghostty.org/docs/config/reference |
| 终端原生 | WezTerm `notification_handling` = `AlwaysShow`/`NeverShow`/`SuppressFromFocusedPane`/`SuppressFromFocusedTab`/`SuppressFromFocusedWindow` | ✅ 终端自己做 | 需要用户配置 | https://wezterm.org/config/lua/config/notification_handling.html |
| 终端原生 | Windows Terminal：OSC 777 通知在窗口聚焦时被抑制（PR 提交 `Suppress notification if focused`） | ✅ 终端自己做 | 版本未确认 | https://github.com/microsoft/terminal/pull/20012 |
| 终端协议 | DECSET 1004 焦点上报（`CSI I` 聚焦 / `CSI O` 失焦） | ⚠️ 理论可行 | **Pi 未暴露开启 1004 的开关**；`ctx.ui.onTerminalInput` 只能监听输入流，无法保证 Pi 已请求焦点事件 | 本地 d.ts；https://iterm2.com/feature-reporting |
| tmux | `focus-events [on\|off]`：启用后向 tmux 内的应用转发焦点事件；`pane-focus-in`/`pane-focus-out` hook | ⚠️ 需用户开启；且是 hook 不是可读变量 | 插件读不到 hook 结果；format 变量只有 `#{client_activity}`（最后活动**时间**，不是焦点布尔值） | https://man7.org/linux/man-pages/man1/tmux.1.html 、https://github.com/tmux/tmux/wiki/Formats |
| macOS | `osascript` 查 frontmost app（如 `tell application "System Events" to get name of first application process whose frontmost is true`） | ⚠️ 会触发权限 | 向 **System Events** 发 AppleEvent 会要求"自动化"授权（PPPC），弹出权限对话框；用户拒绝后返回 `-1743 Not authorized to send Apple events`；需要 `tccutil reset AppleEvents` 才能重新弹窗 | https://scriptingosx.com/2020/09/avoiding-applescript-security-and-privacy-requests/ |
| Linux (X11) | `xdotool getactivewindow` / `wmctrl` | ⚠️ 仅 X11 | **Wayland 下不可用**（xdotool 已过时，需 kdotool 等替代） | https://discuss.kde.org/t/xdotool-replacement-on-wayland/7242 |
| Linux (Wayland) | 各合成器专有协议 / 扩展 | ❌ 不可移植 | 需要按合成器分别实现 | 推断 |
| Windows | 无命令行标准手段 | ❌ | — | 推断 |

### E2. 建议

**不做主动焦点探测。** 理由（推断，基于上表）：
1. 每个平台都要引入额外二进制或权限（macOS 会弹自动化授权、Linux X11 工具在 Wayland 失效、Windows 无手段），而 pi-guard 是安全插件，**新增权限请求本身就是安全与信任成本**；
2. 探测本身有延迟（要 spawn 一个进程并等待结果），而确认框是**阻塞式**的——用户已经不在电脑前时，探测结果来得越晚越没用；
3. 主流终端（Ghostty / WezTerm / Windows Terminal）已内建"聚焦时抑制"，插件再探测属于重复劳动，且两者叠加会产生"终端抑制 + 插件也抑制"的冗余逻辑；
4. 探测失败路径比成功路径多得多，代码复杂度与收益不成比例。

**默认策略：总是通知 + 节流去重。** 用"少而准"代替"智能判断"：
- 同一个确认框只发一次（按 `toolCallId` 或内容哈希去重）；
- 全局最小间隔（建议 1.5–2 s）+ 每分钟上限（建议 3–5 次）；
- macOS 上用 `terminal-notifier -group pi-guard` 让同组通知互相覆盖，天然去重；
- 可选：延迟 0.5–2 s 再发（参考 Claude Code 在权限提示等待约 **6 秒**后才触发 `permission_prompt` 通知的设计，见 https://code.claude.com/docs/en/hooks ），但 pi-guard 的确认框会一直阻塞 agent，因此"立即 + 节流"比"长延迟"更合适；延迟只应作为可配置的降噪选项。

**将来若要做**：必须实现成"探测 → 失败即回退到总是通知"的结构，且**默认关闭**、由用户显式开启。例如 macOS 分支：`osascript` 探测 frontmost，任何非 0 退出码/超时/权限拒绝 → 立即回退"总是通知"。

---

## F. 安全与工程实践（pi-guard 为安全插件，此节权重最高）

### F1. 绝不用 shell 字符串拼接

- **禁止** `node:child_process` 的 `exec`/`execSync`，禁止 `spawn(..., { shell: true })`，禁止把命令文本拼进任何命令行字符串。命令文本来自用户或 AI，包含 `;`、`$(...)`、反引号、`&`、换行等，一旦经过 shell 就是**远程代码执行原语**。
- **必须**用 `spawn(bin, args: string[])`：argv 数组由 `execvp` 直接传递，不经过 shell，不存在 shell 元字符解释。
- **反面教材（真实存在的第三方实现）**：`pi-notify` 的 README 明说其声音钩子 "The command is run in the background (`shell: true`, detached)"。
  来源：https://github.com/ferologics/pi-notify
  → pi-guard **不要**照抄：即使只是"可选声音命令"，`shell: true` 也把注入面重新引回来了。若一定要支持用户自定义命令，也必须由用户提供一个**可执行文件路径 + 参数数组**，而不是一条 shell 字符串。

### F2. 各平台参数语义与转义

**macOS / `osascript`（AppleScript 字符串插值）**

必须处理（顺序很重要）：

1. 先 `\` → `\\`（否则后续插入的反斜杠会被二次解释）；
2. 再 `"` → `\"`；
3. CR/LF/TAB 及其他 C0 控制字符 → 替换为空格（`\r`/`\t`/`\n` 在 AppleScript 中是转义序列，而裸换行会破坏单行语句/字符串字面量）；
4. 可选：整体截断（复用 `summarizeCommand()` 的 240 字符上限）。

来源（规则本身）：https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_classes.html 、https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/conceptual/ASLR_lexical_conventions.html
来源（注入可行性 = 推断）：由"`"` 闭合字面量 + 语句以换行分隔"两条已证实规则推导，未找到公开的 AppleScript 注入 PoC 文档，**建议在插件测试中用一个包含 `"`、`\`、换行、`do shell script "..."` 的样本做回归**。

**更推荐：不插值**（见 A1），用 `on run argv` 让文本以 argv 进入脚本，从设计上消除该转义面。**待验证**：`-e` 形式下参数是否被 `run` handler 接收、是否需要 `--`。

**Linux / `notify-send`**

- 位置参数语义：`summary` 与 `body` 是 `G_OPTION_REMAINING`（源码已证实），**以 `-` 开头的文本会被当作选项解析**。
- 缓解：优先 `--` 分隔（GLib 文档已证实 `--` 会被处理，但存在"`--` 之后仍有以 `-` 开头参数"的例外条款）；**工程上更保险**的做法是：若 `summary`/`body` 首字符是 `-`，前置一个空格（对通知内容无实质影响）。`-a pi-guard`、`-u critical`、`-c` 等选项放在位置参数之前。
- **不要**用 `-w/--wait`（会等待用户关闭通知 → 阻塞语义），**不要**用 `-A/--action`（隐含 `--wait`）。
- `-t` 不要依赖（GNOME/Notify OSD 忽略，见 B1）。

**macOS / `terminal-notifier`**

- 纯 argv，无语言注入面；但注意 property list 怪癖：值首字符为 `[`、`(`、`{`、`"` 等需前置 `\`（README 已证实）。pi-guard 的命令文本常以这些字符开头，**必须处理**。

**Windows / PowerShell（若将来做）**

- 避免 `-EncodedCommand`（EDR 风险，见 C1）；避免把文本拼进 `-Command` 字符串。若必须做，优先考虑 `-File` + 只读 stdin/临时文件，并评估临时文件的安全清理。

### F3. 非阻塞执行

```ts
import { spawn } from "node:child_process";

// 发起通知，不阻塞主流程，失败静默降级
const child = spawn(bin, args, {
  stdio: "ignore",        // 不消费输出，避免管道缓冲写满导致子进程阻塞（Node 文档明确建议）
  detached: true,         // POSIX：新进程组/会话；Windows：可在父进程退出后继续运行（会自带控制台窗口）
  windowsHide: true,      // 抑制 Windows 上的控制台窗口闪烁
});
child.on("error", () => { /* ENOENT 等：静默降级到链上的下一个候选 */ });
const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
timer.unref();
child.unref();            // 不让子进程计入事件循环引用计数
```

依据（文档已证实，`https://nodejs.org/api/child_process.html`）：

- `{ stdio: 'ignore' }`："Use the `{ stdio: 'ignore' }` option if the output will not be consumed."（管道有容量上限，不消费会阻塞子进程）
- `options.detached`："On Windows, setting `options.detached` to `true` makes it possible for the child process to continue running after the parent exits. The child process will have its own console window."；POSIX 下成为新进程组/会话的 leader。
- "When using the `detached` option to start a long-running process, the process will not stay running in the background after the parent exits **unless it is provided with a `stdio` configuration that is not connected to the parent**."
- `subprocess.unref()`："cause the parent process' event loop to not include the child process in its reference count"。
- `ENOENT`："If given, but the path does not exist, the child process emits an `ENOENT` error and exits immediately. `ENOENT` is also emitted when the command does not exist."
- **关键**：`spawn` 失败会 emit `'error'` 事件，**必须同步注册 `error` 监听器**，否则在 Node 中会抛出未捕获异常（可能终止 Pi）。这是"命令不存在"处理的核心，也是"失败静默降级"的实现点。

补充要求：
- **不要用 `spawnSync`**（会阻塞 TUI 渲染/输入）；
- **超时 + SIGKILL**：Linux 侧存在通知服务虚假宣告导致调用方长时间等待的已知故障（B1），必须有超时兜底；
- `windowsHide: true` 必须与 `detached` 搭配，否则 Windows 上会闪出控制台窗口；
- `timer.unref()` 避免超时计时器把进程寿命钉住。

### F4. 节流与去重

**需要**（推断 + 已证实的设计先例）：

| 场景 | 现象 | 处理 |
|---|---|---|
| 同一个确认框被重复触发（事件重入、`/reload`、快速重试） | 同一命令重复弹通知 | 按 `toolCallId`（或 `hash(title + message)`）做一次性去重 |
| 快速连续的危险命令（AI 连续调用 bash） | 通知刷屏 | 全局最小间隔（1.5–2 s）+ 每分钟上限（3–5 次），超出则静默丢弃（确认框本身仍在） |
| 同一命令的多次确认 | 通知中心堆积 | macOS：`terminal-notifier -group pi-guard`（后发覆盖前发，README 已证实）；Linux：`-r replaces_id`（需先 `-p` 拿 ID）或 `-h string:x-canonical-private-synchronous:<key>`（仅部分服务器支持，ArchWiki 已证实有限支持） |
| 用户已在看屏幕 | 噪声 | 交给终端内建的"聚焦时抑制"（Ghostty/WezTerm/WT），插件不判断 |

**不做**：不根据"上一次通知是否被点击"做反馈控制（终端通知无回执，`terminal-notifier` 的 `-action` 会阻塞等待，不可用于此场景）。

### F5. 内容安全（安全插件特有）

- **截断**：复用 `summarizeCommand()`（已把空白折叠、上限 240 字符），不要把完整命令或大段文本塞进通知。
- **不要包含敏感值**：命令文本可能含 token、路径、内网地址；系统通知会进入通知中心（可能被同步/在锁屏可见，取决于系统设置——具体可见性**未在本报告验证**）。建议默认只放"类别 + 摘要"，并提供配置项允许完全关闭正文。
- **标题/正文里不要放无法转义的结构**：统一走 F2 的转义函数，禁止任何"看起来安全所以跳过转义"的分支（例如"只有纯 ASCII 才直接拼接"这类捷径很容易被绕过）。
- **降级顺序中的每一步都必须独立安全**：不能因为"上一步失败"就退化成"用 shell 执行原始文本"。

---

## G. 同类工具的既有做法

| 工具 | 选择 | 具体机制 | 可借鉴之处 | 来源 |
|---|---|---|---|---|
| **Claude Code** | **终端转义（由宿主代写）** + 可配置通知渠道 | hooks 提供 `terminalSequence` 字段：**白名单 OSC 0/1/2/9/99/777 与裸 BEL**，其它（CSI 光标/颜色、OSC 8、OSC 52、OSC 1337）一律拒绝并忽略整字段；由 Claude Code 自己在处理 hook 输出时代写，"race-free，tmux/GNU screen 内可用，Windows 也可用"；**仅交互式会话且界面在屏时生效**，`-p`/SDK 下忽略；hook 自己写 `/dev/tty` 会失败。文档同时把 OSC 9 标注为 iTerm2/ConEmu/Windows Terminal/WezTerm，OSC 99 标注为 Kitty，OSC 777 标注为 urxvt/Ghostty/Warp。`Notification` hook 的 `permission_prompt` 在权限提示等待**约 6 秒**后才触发 | ①**白名单**而非黑名单；②**由宿主代写**而非扩展直写；③把"通知"做成事件 + 字段而不是副作用；④延迟 6 秒再通知以降低噪声；⑤`preferredNotifChannel`（含 `notifications_disabled`）只影响"如何提醒"，不影响 hook 是否运行 | https://code.claude.com/docs/en/hooks |
| **aider** | **系统通知进程**（不是终端转义） | 官方文档："macOS: Uses `terminal-notifier` if available, **falling back to AppleScript notifications**；Linux: Uses `notify-send` or `zenity` if available；Windows: Uses PowerShell to display a message box"；支持 `--notifications-command` 自定义；远程通知推荐 Apprise | **与本次推荐完全一致的降级链**（macOS: terminal-notifier → AppleScript）；把"自定义命令"作为逃生舱；Linux 用 zenity 兜底（本报告不建议照抄） | https://aider.chat/docs/usage/notifications.html |
| **OpenAI Codex CLI** | 系统通知进程（Windows/WSL 下用 PowerShell toast） | `tui.notifications = false` 可关闭；WSL 下实际路径为 `wsl.exe → powershell.exe -NoProfile -NoLogo -EncodedCommand ...` 构造 `ToastNotificationManager` toast，**在企业环境触发 EDR 告警**（`notify` 配置项可执行外部命令） | **反面教训**：Windows/WSL 走 PowerShell `-EncodedCommand` 会被端点防护判定为恶意特征；安全类工具应默认避开这条路，或明确 opt-in | https://community.openai.com/t/codex-cli-on-windows-wsl-triggers-edr-alert-due-to-powershell-encodedcommand-toast-notifications/1375803 、https://community.openai.com/t/feature-request-notifications-when-codex-is-done-with-a-task/1269665 |
| **gemini-cli** | 通过扩展（实验性）+ 终端能力 | 官方有 "Notifications (experimental)" 文档页；生态里有 `gemini-notifier`、`gemini-gnome-notification-extension` 等扩展 | 说明"通知"普遍被做成**可插拔扩展**而非核心硬编码；与本仓库"插件化"形态一致 | https://geminicli.com/docs/cli/notifications 、https://geminicli.com/extensions |
| **Pi 生态：`pi-notify`** | **终端转义 + Windows toast** | 终端检测：Ghostty/WezTerm/rxvt-unicode → OSC 777，iTerm2（`TERM_PROGRAM=iTerm.app`）→ OSC 9，Kitty（`KITTY_WINDOW_ID`）→ OSC 99，tmux → passthrough 包装，Windows Terminal（`WT_SESSION`）→ PowerShell toast；Terminal.app 与 Alacritty 不支持；声音钩子用 `shell: true` + detached | ①**能力探测 → 协议分派**的思路值得借鉴（但应改为"探测系统通知工具"）；②给出了实测过的终端支持表；③**`shell: true` 是必须避免的反面教材**；④它对 Ghostty/WezTerm 选 OSC 777，与 `pi-chime` 选 OSC 9 冲突（两者其实都支持，见 D1） | https://pi.dev/packages/pi-notify 、https://github.com/ferologics/pi-notify |
| **Pi 生态：`pi-chime`** | **终端转义 + osascript + BEL** | 终端检测（Kitty→OSC 99、Ghostty/WezTerm/iTerm2→OSC 9、Warp→OSC 777、Terminal.app→仅 macOS banner）；**每次都追加 BEL 作为通用兜底**；macOS 额外用 `osascript` 发 Notification Center banner；README 声称 osascript 继承调用终端的通知沙箱 | ①**BEL 作为最终兜底**的思路值得保留；②"OSC + 系统通知双发"说明单一 OSC 不够可靠；③其权限归属说法与用户实测冲突（见矛盾点） | https://pi.dev/packages/pi-chime |

**共性结论（推断）**：所有成熟工具都**没有**让"扩展/插件"直接写终端转义序列——Claude Code 由宿主代写，aider/Codex 用独立系统通知进程，Pi 生态的第三方扩展虽然直写 stdout，但只覆盖有限终端且默认关闭/需用户配置。pi-guard 作为安全插件，最稳的选择与 aider 一致：**独立系统通知进程 + 明确的降级链**。

---

## 对比总表（平台 × 方案 × 依赖 × 可靠性 × 失败模式）

| 平台 | 方案 | 依赖 | 可靠性 | 主要失败模式 | 是否推荐 |
|---|---|---|---|---|---|
| macOS | `terminal-notifier` | 需安装（brew/下载/编译）；未 notarize | 高 | ENOENT；Gatekeeper 拦截下载版；未授权（exit 3）；无 GUI/SSH（exit 4）；值首字符 `[({`" 被误解析 | ✅ **首选** |
| macOS | `osascript display notification` | 系统自带 | 中 | Script Editor 未授权 → 静默丢弃；SSH/无 GUI 不可用；未转义 → 语法错误/AppleScript 注入 | ✅ 降级候选（用 `on run argv` 免插值） |
| macOS | `afplay` / 系统音 | 系统自带 | 低 | 静音/耳机/离座无效；无视觉留存；官方文档缺失 | ⚠️ 最后兜底 |
| macOS | OSC 9（iTerm2） | iTerm2 + 未禁用 per-profile 开关 | 低 | 无 API 可用；渲染竞争；无失败反馈 | ❌ 不推荐 |
| Linux | `notify-send` | libnotify（常需手装） | 高（桌面） | ENOENT；无会话总线/SSH；无通知服务器 → 挂起；`-t` 被忽略；`-` 开头参数解析 | ✅ **首选** |
| Linux | `gdbus call`（D-Bus 直连） | glib2 | 中高 | ENOENT；无会话总线；GVariant 参数转义需实测 | ✅ 降级候选 |
| Linux | `zenity` | zenity + X/Wayland | 低 | 模态窗口抢焦点、干扰 TUI；无显示则失败 | ❌ 不推荐 |
| Linux | OSC 777 | Ghostty/WezTerm/rxvt；tmux 需 passthrough | 低 | 见 D 节 | ❌ 不推荐 |
| Windows | PowerShell + WinRT toast | PowerShell + AUMID（BurntToast 非必需） | 中 | AUMID 缺失；**EDR 误报**；转义复杂 | ⚠️ 可选 opt-in，默认关闭 |
| Windows/WSL | `powershell.exe` interop | WSL interop + Windows PATH | 中低 | interop 禁用；`appendWindowsPath=false`；interop 失联；EDR 告警 | ⚠️ 可选 opt-in |
| Windows | `msg` | RDS 特殊权限 | 低 | 无权限；面向 RDS；弹出需确认窗口 | ❌ 不推荐 |
| Windows | WT OSC 777 | WT 新版本 + 用户开启 profile 设置 | 中（默认关） | 版本未确认；默认 disabled；聚焦时抑制；无 API 可用 | ❌ 不推荐（插件侧） |
| 全平台 | BEL `\x07` | 无 | 低 | 仅声音；用户可能关闭响铃 | ⚠️ 最后兜底（限 tui 模式） |

---

## 推荐方案

### 首要方案：独立系统通知进程 + 明确降级链（不写终端转义）

```
触发点：ctx.mode === "tui" && ctx.hasUI && 即将 await ctx.ui.confirm(...) 之前
     ↓
去重/节流门（同一 toolCallId 只发一次；全局最小间隔 + 每分钟上限）
     ↓
按平台走降级链（每一步 spawn(bin, argv) + stdio:"ignore" + detached + unref + 5s SIGKILL 兜底）
     ↓
任何一步 ENOENT / 超时 / 非 0 退出 → 静默尝试下一步；全部失败 → 只做 TUI 内提示（ctx.ui.notify），绝不报错、绝不阻塞确认框
```

**macOS**

1. `terminal-notifier -title "Pi Guard" -subtitle "<类别>" -message "<摘要>" -group pi-guard [-sound default]`
   （值首字符为 `[`、`(`、`{`、`"` 时前置 `\`；纯 argv，无插值）
2. 降级：`/usr/bin/osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title (item 2 of argv)' -e 'end run' <摘要> <标题>`
   （若实测确认 `-e` + argv 不可靠，则退回"严格转义后插值"的版本：`\`→`\\`、`"`→`\"`、控制字符→空格）
3. 再降级：`/usr/bin/afplay /System/Library/Sounds/Glass.aiff`（仅声音）
4. 兜底：静默（TUI 内 `ctx.ui.notify` 已经提示）

**Linux**

1. `notify-send -a pi-guard -u critical -i dialog-warning -- <摘要> <正文>`
   （若实测 `--` 行为有歧义，则对以 `-` 开头的文本前置一个空格）
2. 降级：`gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify "pi-guard" 0 "" <摘要> <正文> [] {} -1`
3. 兜底：静默

**Windows / WSL**

1. **默认只做 BEL（限 `mode === "tui"`）**，并在 README 说明"Windows 原生 toast 需要额外授权与配置"；
2. 可选 opt-in：WT OSC 777 由用户在 Windows Terminal profile 中开启（插件不写 OSC）；若确实要发 toast，用 `powershell.exe -NoProfile -File <固定脚本>` + 参数（**不要用 `-EncodedCommand`**），并在 README 明确 EDR 误报风险；
3. 兜底：静默。

**跨平台工程约束（必须同时满足）**

- 全部 `spawn(bin, argv)`；同步注册 `error` 监听器；`stdio: "ignore"` + `detached: true` + `unref()`；Windows 加 `windowsHide: true`；超时 5 s 后 `SIGKILL` 并 `unref()` 计时器。
- 通知内容复用 `summarizeCommand()` 截断（≤240 字符），不写入完整命令文本作为默认行为。
- 只在 `ctx.mode === "tui"` 且 `ctx.hasUI` 时触发；`print`/`json`/`rpc` 模式一律跳过。
- 新增配置项（示例，需与现有 `GuardConfig` 风格一致）：`notify.enabled`（默认 true）、`notify.onConfirm`（默认 true）、`notify.minIntervalMs`、`notify.maxPerMinute`、`notify.includeCommandText`（默认 false）。
- 运行时依赖：**无**（全部走系统自带或可选外部二进制），符合仓库"运行时依赖写入 dependencies"约束且不引入 npm 依赖。
- 测试（不访问真实网络）：对"转义函数"（含 `"`、`\`、换行、`[`、`-` 开头的样本）、"去重/节流逻辑"、"降级链选择逻辑"做单测；把 `spawn` 注入为可替换依赖，断言 **argv 数组**而不是命令行字符串。

---

## 不建议采用的方案（及理由）

| 方案 | 不采用理由 |
|---|---|
| **在插件里写 OSC 9 / 777 / 99 到 stdout 或 /dev/tty** | Pi 无公开 API；与 `CSI 2026` 同步输出/差量渲染竞争，可能撕裂序列导致屏幕错乱；污染 `print`/`json`/`rpc` 输出；终端覆盖有限（Terminal.app/Alacritty 不支持）、tmux 需用户开 `allow-passthrough`（默认 off，且 pane 不可见时不生效）、WT 的 OSC 777 默认关闭；失败无反馈无法降级。Claude Code 的官方做法也是**由宿主代写**（`terminalSequence`），并明确 hook 直写 `/dev/tty` 会失败 |
| **`exec` / `spawn({shell:true})` 拼命令字符串** | shell 元字符解释 → 命令注入（命令文本来自用户/AI）。`pi-notify` 用 `shell:true` 跑声音钩子，属反面教材 |
| **`spawnSync` / 同步等待通知进程** | 阻塞 TUI 事件循环与输入处理；通知是 best-effort 副作用，不该影响确认框 |
| **Linux 用 `zenity` 弹窗** | 模态对话框抢焦点、需 X/Wayland、与全屏 TUI 冲突，且不是通知中心气泡 |
| **Windows 用 `msg`** | 面向 RDS，需特殊权限，会弹出需确认/会超时的窗口 |
| **Windows/WSL 用 PowerShell `-EncodedCommand` 发 toast** | 真实案例显示会被 EDR 判定为恶意特征（Codex CLI 报告）；安全插件不应自我制造告警 |
| **主动焦点探测（osascript System Events / xdotool / tmux hook）** | macOS 会弹自动化授权（PPPC）、拒绝后 `-1743`；xdotool 在 Wayland 失效；tmux 只有 hook 没有可读的焦点变量；探测延迟对阻塞式确认框无意义；主流终端已内建"聚焦时抑制" |
| **`notify-send -w` / `-A` 或 `terminal-notifier -action` 做交互式确认** | 会等待用户输入（隐含 `--wait`），把通知变成阻塞调用，与"非阻塞 + 静默降级"原则冲突；确认必须留在 Pi 的 `ctx.ui.confirm` 里 |

---

## 矛盾点

1. **osascript 通知的权限归属**：macOS 用户实测（Sequoia）显示通知归属到 **Script Editor**（需要先给 Script Editor 开通知权限，Terminal 不需要）；而 `pi-chime` README 声称 osascript "inherits the notification sandbox of the calling terminal process"。
   来源：https://www.macscripter.net/t/trying-to-use-terminal-for-display-notification/76593 vs https://pi.dev/packages/pi-chime
   → 未解决。本报告以**用户实测**为较可信的一方（并因此把 osascript 定位为"降级候选"而非首选），但两者都不是官方文档，且 macOS 版本间可能变化。
2. **Ghostty/WezTerm 该用 OSC 9 还是 777**：`pi-notify` 对 Ghostty/WezTerm 用 OSC 777，`pi-chime` 对 Ghostty/WezTerm 用 OSC 9。
   来源：https://pi.dev/packages/pi-notify vs https://pi.dev/packages/pi-chime
   → 不构成实质冲突：Ghostty 官方配置参考明确支持 **OSC 9 与 OSC 777 两者**，WezTerm 官方 escape 表也同时列出两者。两个扩展只是各选其一。
3. **Windows Terminal OSC 777 的可用版本**：issue #7718 已 CLOSED(COMPLETED)、PR #20012 已 MERGED(2026-06-04)，但 WT Preview 1.24/1.25 官方发布博客均未提及该特性。
   → 只能确认"已合入 main"，**稳定版可用性未证实**。
4. **notify-send 的 `--` 支持**：GLib 文档证实 `--` 会被处理（带例外条款），但 `notify-send(1)` man page 完全没有记录 `--`。
   → 结论标为"待验证"。

---

## 缺失证据 / 待验证清单

1. **`osascript -e ... <args>` 形式下 argv 是否被 `run` handler 接收**，以及是否需要 `--`、参数以 `-` 开头时的行为（man page 只示范了"脚本文件 + 参数"形式）。
2. **macOS 通知归属**（Script Editor vs 调用终端）在**当前 macOS 版本**下的实际行为，以及"用户从未运行过 Script Editor"时是否连权限弹窗都不会出现（若是，则 osascript 降级链在全新机器上可能直接静默失败）。
3. **`notify-send --` 的实测行为**，尤其是 summary/body 以 `-` 开头时。
4. **`gdbus call` 传任意文本的参数转义规则**（GVariant 字面量）与超时行为。
5. **Windows Terminal OSC 777 进入哪个稳定版本**，以及 profile 设置的确切 JSON 键名与默认值。
6. **`WT_SESSION` 在 WSL 内是否可见**（`pi-notify` 依赖它做分派）。
7. **PowerShell 不用 `-EncodedCommand` 时传递任意 toast 文本的安全方式**，以及未打包进程可用的稳定 AUMID。
8. **`afplay` 的官方文档**（未找到 developer.apple.com 上的 man page）。
9. **系统通知在锁屏/通知中心的可见性**（涉及把命令文本放进通知的隐私判断）。
10. **`terminal-notifier` 的 property list 首字符怪癖的完整触发集合**（README 只给了 `[`、`(`、`{`、`"` "or similar"）。
11. **AppleScript 字符串注入的最小 PoC**（本报告把"可注入"标为推断，未找到公开 PoC 文档；建议用回归测试实证）。
12. **`pi-guard` 现有 `ctx.ui.confirm` 是否设置 `timeout`**（本地 `policy.ts` 未传 `timeout`；若将来加 `timeout`，通知策略需要重新评估"用户不在时对话框自动消失"的语义）。

---

## Sources

### Kept（按重要性）

- **Apple – Mac Automation Scripting Guide: Displaying Notifications**（https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/DisplayNotifications.html）— `display notification` 的 title/subtitle/sound name 官方语法。
- **Apple – AppleScript Language Guide: Class Reference（text / Special String Characters）**（https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_classes.html）— 字符串转义规则的权威来源（`\\`、`\"`、`\r`/`\t`/`\n`）。
- **Apple – AppleScript Language Guide: Lexical Conventions**（https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/conceptual/ASLR_lexical_conventions.html）— "语句通常单行"，支撑"裸换行破坏字面量"的推断。
- **osascript(1) man page**（https://www.unix.com/man_page/osx/1/osascript）— "arguments … passed as a list of strings to the direct parameter of the `run` handler"，免插值传参的唯一权威依据。
- **julienXX/terminal-notifier README**（https://github.com/julienXX/terminal-notifier）— 安装方式、未 notarize/Gatekeeper、property list 首字符坑、`-group` 去重、`-diagnose`、退出码 3/4/5/6、"No GUI session … cannot be posted over SSH"。
- **iTerm2 Proprietary Escape Codes**（https://iterm2.com/documentation-escape-codes.html）— `OSC 9 ; msg ST` 通知与 `OSC 9;4` 进度条。
- **WezTerm Escape Sequences**（https://wezterm.org/escape-sequences.html）— OSC 9 与 `\e]777;notify;title;body\e\\` 的官方支持声明。
- **Ghostty – Show Desktop Notification (OSC 9)**（https://ghostty.org/docs/vt/osc/9）— OSC 9 语义与 OSC 9;n 冲突提醒。
- **Ghostty – Option Reference**（https://ghostty.org/docs/config/reference）— "OSC 9 or OSC 777" 默认允许；`command-finished-notification`（never/unfocused/always）与 `bell-features` 的焦点感知能力。
- **kitty – Desktop notifications (OSC 99)**（https://sw.kovidgoyal.net/kitty/desktop-notifications/）— OSC 99 完整规范（metadata/分块/Base64/回传/应用名与类型）。
- **kovidgoyal/kitty issue #1474**（https://github.com/kovidgoyal/kitty/issues/1474）— kitty 拒绝 OSC 777、实现 OSC 99 并向后兼容 OSC 9；iTerm2 作者对 OSC 9 能力边界的说明。
- **microsoft/terminal issue #7718**（https://github.com/microsoft/terminal/issues/7718）— OSC 777 需求历史、最终 CLOSED(COMPLETED)。
- **microsoft/terminal PR #20012**（https://github.com/microsoft/terminal/pull/20012）— OSC 777 实现细节、**默认关闭**、聚焦时抑制、schema 新增设置、文档未更新。
- **WezTerm `notification_handling`**（https://wezterm.org/config/lua/config/notification_handling.html）— 终端侧焦点感知抑制的官方配置项。
- **freedesktop Desktop Notifications Specification – D-BUS Protocol**（https://specifications.freedesktop.org/notification/latest/protocol.html）— `Notify` 方法签名与 vendor 扩展规则。
- **notify-send(1)（Arch / Debian man page）**（https://man.archlinux.org/man/notify-send.1.en 、https://manpages.debian.org/testing/libnotify-bin/notify-send.1.en.html）— 选项语义与 `-t` 被部分服务器忽略的说明。
- **libnotify `tools/notify-send.c`**（https://raw.githubusercontent.com/GNOME/libnotify/master/tools/notify-send.c）— `G_OPTION_REMAINING` 位置参数实现（源码级证据）。
- **GLib `OptionContext.parse`**（https://docs.gtk.org/glib/method.OptionContext.parse.html）— `--` 的官方处理规则与例外条款。
- **ArchWiki – Desktop notifications**（https://wiki.archlinux.org/title/Desktop_notifications）— 通知服务器清单、"需手动安装/自动激活"、`x-canonical-private-synchronous` 替换技巧、"挂起一分钟"故障。
- **tmux(1) man page**（https://man7.org/linux/man-pages/man1/tmux.1.html）— `allow-passthrough`（on/all 与 pane 可见性）、`focus-events`、`pane-focus-in/out`。
- **tmux Wiki – Formats**（https://github.com/tmux/tmux/wiki/Formats）— `client_activity` 是最后活动时间（不是焦点布尔值）。
- **Node.js `child_process` 文档**（https://nodejs.org/api/child_process.html）— `detached`/`unref`/`stdio:'ignore'`/`windowsHide`/`ENOENT` 的权威语义。
- **Claude Code – Hooks reference**（https://code.claude.com/docs/en/hooks）— `terminalSequence` 白名单、"由宿主代写、race-free"、`permission_prompt` 约 6 秒延迟、交互式限定。
- **aider – Notifications**（https://aider.chat/docs/usage/notifications.html）— 官方记录的降级链（terminal-notifier → AppleScript；notify-send/zenity；PowerShell）。
- **OpenAI 社区：Codex CLI WSL EDR 告警**（https://community.openai.com/t/codex-cli-on-windows-wsl-triggers-edr-alert-due-to-powershell-encodedcommand-toast-notifications/1375803）— WSL→PowerShell `-EncodedCommand` toast 被 EDR 标记的真实案例。
- **Microsoft Learn – `ToastNotificationManager.CreateToastNotifier`**（https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotificationmanager.createtoastnotifier?view=winrt-28000）— 桌面应用必须传 AppUserModelID。
- **Microsoft Learn – `msg`**（https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msg）— RDS 定位与权限要求。
- **Microsoft Learn – WSL interop / wsl-config**（https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop 、https://learn.microsoft.com/en-us/windows/wsl/wsl-config）— interop 机制、`[interop] enabled`/`appendWindowsPath`、`wsl.exe` 不可假设存在。
- **Windows Command Line 博客 – Bash/Windows interop**（https://devblogs.microsoft.com/commandline/interop-between-windows-and-bash/）— Windows 路径追加进 Linux `PATH`、`.exe` 必需。
- **Scripting OS X – Avoiding AppleScript Security and Privacy Requests**（https://scriptingosx.com/2020/09/avoiding-applescript-security-and-privacy-requests/）— 向 System Events 发事件会触发自动化授权、`-1743`、`tccutil reset AppleEvents`。
- **Scripting OS X – AppleScript from Shell Script**（https://scriptingosx.com/2022/05/launching-scripts-4-applescript-from-shell-script/）— `on run arguments` 用法与 macOS 隐私弹窗的实务说明。
- **`@earendil-works/pi-tui` README**（https://github.com/earendil-works/pi/blob/main/packages/tui/README.md）— 差量渲染 + `CSI 2026` 同步输出 + 行尾 reset（D 节的核心依据）。
- **本机公开 API**：`plugins/pi-guard/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts`、`dist/core/extensions/types.d.ts`、`package.json`（`ExtensionUIContext` 能力面与 `engines.node`）。按仓库约定，本机公开 API 优先于在线文档。

### Rejected / deprioritized

- **`pi-notify` / `pi-chime` README（作为事实来源）**— 保留为"Pi 生态既有做法"的证据，但其终端支持表与权限说法未提供一手依据，且 `pi-notify` 使用 `shell: true`，故不作为选型依据。
- **vtdn.dev / docs.otty.sh / agentnotch / zenn.dev 等 OSC 参考站**— 二手整理，OSC 编号细节未提供规范来源；已用 iTerm2 / WezTerm / Ghostty / kitty / WT 一手文档替代。
- **ss64.com（afplay / notify-send）**— 第三方整理的 man page 镜像；afplay 未找到官方来源，已在"待验证"标注。
- **Medium / 个人博客类"macOS 通知教程"**— 与 Apple 官方文档重复且无额外一手信息。
- **`rocketreach.co` / `cbinsights.com` 等公司信息页**— 搜索噪声，与主题无关（多次出现在"OSC"相关查询中，已忽略）。
- **`learn.microsoft.com` "Send a local toast notification"（原 URL 404）与 Claude Code settings-reference（页面过大无法抓取）**— 未能取到原文，相关结论改由 CreateToastNotifier API 文档与 hooks 文档支撑，并已标注限制。

### 验证限制说明

本报告未使用 `source_check` 对逐条主张做二次交叉验证（该工具未在本轮加载注册），改为**直接抓取并阅读原始文档/man page/源码**（Apple 官方指南、osascript man page、GLib 文档与 libnotify 源码、Node.js 文档、tmux man page、freedesktop 规范、各终端官方文档、GitHub issue/PR 原文）。凡未能取到一手来源的主张，均已显式标注为"社区证据""推断"或"待验证"。

---

## Next steps

1. **实测三件事**（决定最终降级链形态，均可离线/本地完成）：
   a. `osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title (item 2 of argv)' -e 'end run' -- "msg" "title"` 是否工作、参数以 `-` 开头时是否需要 `--`；
   b. `notify-send -- "-leading" "body"` 的实际行为；
   c. 在本机 macOS 上确认 `osascript display notification` 的通知归属（Script Editor vs 当前终端）以及全新机器上的首次权限弹窗是否出现。
2. **验证 `terminal-notifier` 的 property list 首字符触发集合**（构造以 `[`、`(`、`{`、`"`、`-`、空格 开头的 `-message`，逐个实测是否需要前置 `\`）。
3. **写回归测试样本**：命令文本包含 `"`、`\`、换行、`$()`、反引号、`;`、以 `-` 开头、以 `[` 开头，断言最终传给 `spawn` 的是**argv 数组**且内容与预期一致（不访问真实网络，`spawn` 用替身）。
4. **若考虑 Windows toast**：确认可用的稳定 AUMID 与"不用 `-EncodedCommand`"的传参方案，再决定是否提供 opt-in。
5. **跟踪 Pi 上游**：如果 `ExtensionUIContext` 未来暴露"由宿主代写转义序列"的 API（对标 Claude Code 的 `terminalSequence`），则重新评估 OSC 9/99/777 作为零依赖方案的价值。

---

## Supervisor coordination

本轮无需决策或澄清；未遇到阻塞。已将结论与残留风险直接返回，未向 supervisor 发送额外消息。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "报告已写入 docs/research/pi-guard-notification-os-mechanisms.md，覆盖 A–G 全部必答问题，含平台×方案×依赖×可靠性×失败模式对比表、推荐方案与降级链、不建议采用清单，以及矛盾点/待验证清单；所有结论均标注来源 URL 并区分『文档已证实 / 社区证据 / 推断 / 待验证』。"
    }
  ],
  "changedFiles": [
    "docs/research/pi-guard-notification-os-mechanisms.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search（多角度批量查询：osascript/terminal-notifier、OSC 9/777/99、notify-send/D-Bus、WT/PowerShell/WSL、Claude Code/Codex/aider/gemini-cli）",
      "result": "passed",
      "summary": "完成 4 批多角度检索，用于发现一手来源"
    },
    {
      "command": "fetch_content（Apple 官方指南、iTerm2/WezTerm/Ghostty/kitty 官方文档、freedesktop 规范、notify-send man page、libnotify 源码、Node.js 文档、tmux man page、GitHub issue/PR、Claude Code hooks、aider 文档、MS Learn）",
      "result": "passed",
      "summary": "抓取并逐条核对原文，关键主张均落到一手来源"
    },
    {
      "command": "read（本机 plugins/pi-guard 与 @earendil-works/pi-coding-agent 的公开类型定义/package.json）",
      "result": "passed",
      "summary": "确认 Pi 未暴露写转义序列的公开 API，并确认 ExtensionUIContext/ExtensionMode 能力面"
    }
  ],
  "validationOutput": [
    "核心结论：Pi 插件不应直写 OSC 转义序列（无公开 API + CSI 2026 同步输出/差量渲染竞争 + 非 TUI 模式输出污染 + 终端覆盖有限且默认关闭 + 失败无反馈）；Claude Code 官方 hooks 文档明确要求由宿主代写 terminalSequence（race-free），并说明 hook 直写 /dev/tty 会失败。",
    "推荐降级链：macOS terminal-notifier → osascript（on run argv 免插值）→ afplay → 静默；Linux notify-send → gdbus call → 静默；Windows 默认仅 BEL，toast 为 opt-in 且禁用 -EncodedCommand（EDR 真实案例）。",
    "工程约束：spawn(bin, argv) + 同步注册 error 监听器（ENOENT 否则抛未捕获异常）+ stdio:'ignore' + detached + unref + windowsHide + 5s SIGKILL 兜底；全部依据 Node.js 官方 child_process 文档。",
    "关键来源样例：https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_classes.html 、https://github.com/julienXX/terminal-notifier 、https://github.com/microsoft/terminal/pull/20012 、https://code.claude.com/docs/en/hooks 、https://nodejs.org/api/child_process.html"
  ],
  "residualRisks": [
    "未使用 source_check 做二次交叉验证（该工具本轮未加载注册），改为直接抓取一手文档/man page/源码；已在此报告中显式披露该验证限制。",
    "osascript 通知的权限归属（Script Editor vs 调用终端）仅有社区实测证据且与第三方 pi-chime README 冲突，未解决；若归属 Script Editor，全新机器上降级链可能静默失败。",
    "osascript -e 形式的 argv 传参、notify-send 的 -- 行为、Windows Terminal OSC 777 进入哪个稳定版本及其设置键名，均标为待验证，需本地实测。",
    "Windows toast 的稳定 AUMID 与『不用 -EncodedCommand』的传参方式未证实，因此建议默认关闭。",
    "未修改 plugins/ 下任何文件；仅新增一份 docs/research 报告。"
  ],
  "noStagedFiles": true,
  "diffSummary": "新增 docs/research/pi-guard-notification-os-mechanisms.md（中文调研报告，含对比表、推荐方案/降级链、不建议方案、矛盾点、待验证清单与来源清单）；未改动 plugins/ 或任何代码文件。",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "报告写入了指定路径 /Users/lystran/programming/ai/pi-extensions/docs/research/pi-guard-notification-os-mechanisms.md（docs/research 目录已存在）。为满足『每条结论标注来源』要求，报告刻意保留了少量社区证据（macscripter 论坛、OpenAI 社区、ArchWiki）并明确标注其等级；其余关键主张均落在一手来源。本机 API 证据取自 plugins/pi-guard/node_modules 下的公开 .d.ts 与 package.json（按 AGENTS.md『本机公开 API 优先』处理）。额外发现两条对 pi-guard 有价值的信息：(1) Pi 的 ctx.ui.confirm 支持 timeout（会自动消失），若启用会改变『用户不在电脑前』的语义，需与通知策略一起评估；(2) pi-notify 使用 shell:true 执行用户自定义声音命令，属安全反模式，不应照抄。"
}
```

# 调研：pi-guard 终端 OSC 通知前置层 —— tmux/screen 影响与现成库评估

> 调研日期：2026-09（本机 Darwin arm64；本机 tmux 3.7c；Pi 0.87.1；npm registry 快照为 2026-09）
> 任务：回答 (A) tmux/screen 会不会影响 pi-guard 的 OSC 通知方案；(B) 有没有现成的库可以直接调用
> 输入基础：前一轮证据文件（`/tmp/pi-notify-libs-evidence.md`，本轮已读取并抽样复核）、仓库既有调研（`docs/research/pi-notification-delivery-api.md`、`rpiv-ask-user-question-attention-signals.md`、`pi-guard-notification-os-mechanisms.md`，本轮只引用不重复）、本机 Pi 0.87.1 包的 `examples/extensions/notify.ts`、`plugins/pi-guard/src/notify.ts`
>
> 证据等级：
> - 【源码证实(master)】/【源码证实(3.7c tag)】= 直接读到源码/配置表原文（本轮抓取的 tmux、GNU screen、node-notifier、Pi 生态扩展源码）
> - 【官方 CHANGES 证实】= tmux 仓库 `CHANGES` 原文
> - 【文档证实】= 官方 man page / 官方文档 / 官方支持的序列表
> - 【registry 证实】= `registry.npmjs.org` 的 JSON 元数据或 unpkg 的文件清单（本轮无 shell 工具，等价替代 `npm view`）
> - 【本地文件证实】= 本机仓库或 dotfile 的原文
> - 【命令输出·未复核】= 承继前一轮证据文件的命令输出，本轮无法重跑（无 shell 工具）
> - 【推断】= 由已证实事实推导，无直接来源
> - 【未证实】= 本轮未取得证据
>
> 本轮方法限制（重要）：本子代理只有文件读取与网络抓取工具，**没有 shell**，因此无法重跑 `npm view` / `env` / `tmux show-options` / `bun run verify`。所有 registry 相关复核都改用 `registry.npmjs.org` 的 HTTP JSON 与 `unpkg.com` 的文件清单（两者正是 npm CLI 的同一数据源）；所有「本机环境变量值」承继前一轮命令输出并显式标注【命令输出·未复核】。本轮**未修改仓库内任何文件，只新增本报告**。

---

## Summary

- **tmux 一定会影响该方案，且影响是「前置否决」级别**：tmux 3.7c 的 OSC 分派表里 `777`/`99` 根本没有分支（`default: log_debug("unknown")`，直接丢弃），`OSC 9` 只被识别为 `9;4` 进度条；唯一通路是把序列包成 `ESC P tmux; <payload> ESC \` 的 DCS passthrough，而且要求用户显式开 `allow-passthrough`（默认 off），payload 内的每个 `ESC` **必须写成两个 `ESC`**（tmux 的输入状态机 `dcs_escape` 会吃掉一个、保留一个），并且 `allow-passthrough on` 在「本 pane 不可见」时**不生效**——正好覆盖「用户切走后需要通知」的场景。此外 tmux 会把 `TERM_PROGRAM` 覆写成 `tmux`（3.3 起），使所有基于 `TERM_PROGRAM` 的终端识别在内层失效。
- **GNU screen 更差**：screen 的 OSC 处理只认编号 `0/1/2/11/20/39/49`，`777`/`99` 走 `break` 被直接丢弃，且 screen 没有 tmux 那样的 passthrough 开关（源码与 man page 均未见）。
- **问题 B 的结论：终端 OSC 通知方向没有可直接调用的现成库**（只有「OSC 9;4 进度条」这类库，如 `osc-progress`；OSC 通知的实现全部是应用级插件，不是库）。跨平台桌面通知方向有 `node-notifier`，但它是 CJS、6 个运行时依赖、**捆绑 terminal-notifier.app 与 SnoreToast/Notifu 二进制**（解包 5.68 MB、包内 3 份独立 LICENSE），且内部 `execFile` 没有超时，与 pi-guard 现有「逐级降级 + 5s SIGKILL + 退出码判定」不等价。若一定要自写 OSC 层，可照搬 `pi-tmux-notify` 的检测/序列/DCS 包装与字符清理口径，但**不要**照搬 `@jmcombs/pi-notify`（它对 title/body 完全不做控制字符清理）。

---

## 0. 本轮对前一轮证据的抽样复核

复核方式：重新读取 registry HTTP JSON（`/latest`）、`unpkg` 文件清单（`?meta`）与包内源码；重读本机仓库文件。

| # | 前一轮证据声称 | 本轮复核结果 | 判定 |
| --- | --- | --- | --- |
| 1 | node-notifier 10.0.1：MIT、6 依赖（growly/is-wsl/semver/shellwords/uuid/which）、无 engines、无自带 `.d.ts`、解包 5,677,839 | `registry.npmjs.org/node-notifier/latest`：`license: MIT`、`dependencies` 恰为那 6 个、无 `engines`、无 `types`、`unpackedSize: 5677839`、`main: index.js` | ✅ 相符 |
| 2 | node-notifier 包内自带 `terminal-notifier.app`/SnoreToast/Notifu 二进制 | `unpkg.com/node-notifier@10.0.1/?meta` 文件清单含 `vendor/mac.noindex/terminal-notifier.app/Contents/MacOS/terminal-notifier`(87,688 B)、`Contents/Resources/Terminal.icns`(369,386 B)、`vendor/snoreToast/snoretoast-x64.exe`(2,519,032 B)、`snoretoast-x86.exe`(2,065,912 B)、`vendor/notifu/notifu.exe`(245,760 B)、`notifu64.exe`(296,448 B)，以及 3 份独立 LICENSE（`vendor/terminal-notifier-LICENSE`、`vendor/notifu/LICENSE`、`vendor/snoreToast/LICENSE`） | ✅ 相符，且**强于**原描述（可给出字节数与许可证文件清单） |
| 3 | pi-tmux-notify 0.0.3：零依赖、MIT、unpacked 14,230；写入 `/dev/tty`；tmux 内包 DCS 且 ESC 翻倍；要求 `allow-passthrough all`；清理 `\x00-\x1f,\x07,\x9c` 与 `;` | registry JSON 与源码（`extensions/index.ts`，unpkg）逐条命中：`unpackedSize: 14230`、无 `dependencies`、`/dev/tty` + stdout 回退、`sequence.replace(/\x1b/g,"\x1b\x1b")` 包 `${ESC}Ptmux;…${ST}`、`show -Ap … allow-passthrough` 非 `all` 时警告、`sanitize()` 正则完全一致 | ✅ 相符 |
| 4 | detect-terminal 3.0.0：MIT、零依赖、unpacked 520,098、`types: dist/index.d.ts` | registry JSON 相符（另有 `module: dist/index.mjs`、`main: dist/index.js`） | ✅ 相符 |
| 5 | （前一轮把 `pi-notify 1.4.0` 与 `@zzxb/pi-notify` 并列） | **纠正**：`@zzxb/pi-notify` 的 `latest` 是 **0.0.1**（2026-09 快照），且其 `index.ts` 内**没有任何 OSC/终端序列代码**，是一个调用外部 Windows helper 的 toast 扩展（`runHelper(pi, ctx, "Show", ["-Title", …, "-Body", …, "-SessionKey", …])`，在 `agent_settled`/阻塞态触发） | ⚠️ 需纠正任务前提：「@zzxb/pi-notify 的 terminal-signals」在已发布包中不存在 |
| 6 | （前一轮未覆盖）node-notifier 的失败/超时行为 | 源码：macOS 走 `utils.fileCommandJson(customPath || 指向包内 terminal-notifier.app 的路径, args, cb)` → `cp.execFile(notifier, options, cb)`，**未传 `timeout`**；`notifiers/notificationcenter.js` 用 `path.join(__dirname,'../vendor/mac.noindex/…/terminal-notifier')` | 🆕 新增事实：**没有超时**（与 pi-guard 的 5s SIGKILL 不等价） |
| 7 | （前一轮未覆盖）`~/.tmux.conf` 无 `allow-passthrough`，故推断本机 `on` 可能是 tmux 3.7c 内置默认 | **纠正**：本机确实另有 `~/.tmux.conf.local`，其 **L13 `set -g allow-passthrough on`** 是显式配置；tmux 3.7c 的 options-table 里 `allow-passthrough` 的 `default_num = 0`（off）。因此前一轮的「可能是内置默认」推断**错误** | ⚠️ 已纠正 |
| 8 | （前一轮未覆盖）`node-notifier` 的 registry `lastPublish` 2026-06-29 | 版本自身的发布元数据 `_npmOperationalInternal.tmp = "..._1643748014354_..."` → 该版本发布时刻为 **2022-02-01**；2026-06-29 更可能是 packument 的 `time.modified`（元数据被触碰的时间）。二者不可混用 | ⚠️ 口径需澄清 |

结论：前一轮证据的**语义基本可靠**，本轮在此基础上纠正 2 条（tmux 3.7c 默认值来源、@zzxb/pi-notify 的实际形态）、澄清 1 条（lastPublish 口径）、新增 3 条（node-notifier 无超时、GNU screen 源码行为、tmux 源码级 passthrough 语义）。

---

## 1. 问题 A：tmux / screen 会不会影响这个方案

### A.0 直接回答

会，而且是**两层否决**：

1. **裸 OSC 在 tmux/screen 内 100% 无效**：`777`/`99` 会被多路复用器直接丢弃（不进外层终端）；`OSC 9` 在 tmux 里只被当成 `9;4` 进度条，带文字的 `OSC 9` 通知也被丢弃。
2. **要绕过得写 DCS passthrough 并依赖用户配置**：需要 `allow-passthrough`（tmux 3.7c 默认 off；`on` 只对可见 pane 生效）、payload 内 ESC 必须翻倍，且内层**无法可靠识别外层终端**（`TERM_PROGRAM` 被 tmux 覆写为 `tmux`）。

因此「仅在检测到支持时才写」的口径必须显式处理 tmux/screen 这两个环境，否则至少一种失败模式一定会出现（静默无效，或更糟：序列被吃一半导致可见乱码——见 A.2 的 ESC 语义）。

### A.1 身份变量是否透传（tmux）

| 变量 | 在 tmux 内 pane 中的值 | tmux 的行为 | 证据 |
| --- | --- | --- | --- |
| `TERM_PROGRAM` | `tmux` | **覆写**（3.3 起主动导出自己的值，不保留外层值） | 【官方 CHANGES 证实】`CHANGES FROM 3.2a TO 3.3`：「Export TERM_PROGRAM and TERM_PROGRAM_VERSION like various other terminals.」；【命令输出·未复核】本机 tmux 3.7c 内 `TERM_PROGRAM=tmux` |
| `TERM_PROGRAM_VERSION` | `3.7c`（tmux 版本） | 同上（导出的是 tmux 自己的版本号，**不是**外层终端版本） | 同上 |
| `TERM` | `tmux-256color` | **覆写**（由 `default-terminal` 决定） | 【源码证实(master/3.7c)】`options-table.c`：`default-terminal` 默认 `TMUX_TERM`；【命令输出·未复核】本机 `TERM=tmux-256color`。注：本机 `~/.tmux.conf` 里写的是 `set -g default-terminal "screen-256color"`，而 oh-my-tmux 的脚本段含 `tmux set -g default-terminal 'tmux-256color'`【本地文件证实】——两者叠加后本机实际生效值是 tmux-256color |
| `KITTY_WINDOW_ID` | 若外层是 kitty：**保留**（外层值原样可见） | tmux 源码/CHANGES 中**没有**任何清理或改写该变量的逻辑 | 【源码证实(master/3.7c)】：`input.c`/`session.c`/`options-table.c` 均无 `KITTY` 处理；`CHANGES` 全文无 `KITTY` 命中【官方 CHANGES 证实】 |
| `WT_SESSION` / `WT_PROFILE_ID` | 若在 Windows Terminal（含 WSL）里启动 tmux：**保留** | 同上（无清理逻辑） | 【源码证实】：`CHANGES` 全文无 `WT_SESSION` 命中；【推断】 |
| `ITERM_SESSION_ID` / `TERM_SESSION_ID` | iTerm2 下**保留** | 同上 | 【命令输出·未复核】本机在 tmux 内仍可见 `ITERM_SESSION_ID=w0t1p0:…` |
| `GHOSTTY_RESOURCES_DIR` 等 Ghostty 变量 | 若外层是 Ghostty：**推断保留** | 同上 | 【推断】（无 tmux 端处理证据，也无本机样本） |

「外层 iTerm2 / Ghostty / WezTerm + 内层 tmux」与「外层 kitty + 内层 tmux」的差异，**只体现在**「非 `TERM_PROGRAM` 类变量是否幸存」：

| 组合 | 内层可见的外层线索 | 不可见的线索 |
| --- | --- | --- |
| 外层 iTerm2 + tmux | `ITERM_SESSION_ID`（+ `TERM_SESSION_ID`） | `TERM_PROGRAM=iTerm.app`（被覆写为 `tmux`） |
| 外层 Ghostty + tmux | `GHOSTTY_RESOURCES_DIR`（推断） | `TERM_PROGRAM=ghostty` |
| 外层 WezTerm + tmux | 无已知专用变量（WezTerm 用 `TERM_PROGRAM=WezTerm` / `TERM=wezterm`，都会被覆盖或不被导出） | 两个线索都失效 |
| 外层 kitty + tmux | `KITTY_WINDOW_ID`、`TERM=xterm-kitty`?（`TERM` 被覆写，`KITTY_WINDOW_ID` 幸存） | `TERM_PROGRAM=kitty` |

两个必须知道的附加风险：

- **过期（stale）**：tmux 的 `update-environment`（session 选项）默认只包含 `DISPLAY KRB5CCNAME MSYSTEM SSH_ASKPASS SSH_AUTH_SOCK SSH_AGENT_PID SSH_CONNECTION WAYLAND_DISPLAY WINDOWID XAUTHORITY XDG_CURRENT_DESKTOP XDG_SESSION_DESKTOP XDG_SESSION_TYPE`【源码证实(master/3.7c) `options-table.c`】，**不含**任何终端身份变量。因此在 A 终端创建 tmux 会话、之后在 B 终端 reattach，pane 里的 `KITTY_WINDOW_ID`/`ITERM_SESSION_ID` 仍是**旧终端**的值 → 检测会指向错误的终端 → 要么序列被外层忽略，要么被错误终端渲染。
- **嵌套**：tmux ⊕（tmux|screen）时上述结论逐层叠加，`TERM_PROGRAM` 仍是 `tmux`。

**screen 侧**：screen 只把 `TERM` 改成 `screen`/`screen-256color` 并导出 `STY`、`WINDOW`；本轮未取到 screen 的环境清理源码，故「screen 是否覆写 `TERM_PROGRAM`」标记为【未证实】（实践上 screen 不会像 tmux 3.3+ 那样主动导出 `TERM_PROGRAM`，因此外层 `TERM_PROGRAM` 可能**幸存**——这是一个「看起来能检测、实际未必可用」的陷阱，因为 screen 根本不转发 OSC）。

### A.2 OSC 透传行为

#### tmux：裸 OSC 被丢弃（不是透传、不是消费成通知）

tmux 3.7c `input.c` 的 `input_exit_osc()` 分派表（原文摘录）：

```c
	case 0:
	case 2:  …（title；需 allow-set-title）
	case 4:  input_osc_4(ictx, p);   break;   /* 调色板 */
	case 7:  …（pane 当前路径）
	case 8:  input_osc_8(ictx, p);   break;   /* 超链接 */
	case 9:  input_osc_9(ictx, p);   break;   /* 见下：只处理 9;4 */
	case 10: case 11: case 12: …     break;   /* 默认前景/背景/光标色 */
	case 52:  input_osc_52(ictx, p); break;   /* 剪贴板 */
	case 104/110/111/112: …          break;
	case 133: input_osc_133(ictx, p);break;   /* shell 集成事件 */
	default:  log_debug("%s: unknown '%u'", __func__, option);   /* 丢弃 */
	}
```

`input_osc_9()` 的实现开头即 `if (*pb++ != '4') return;`，即**只有 `OSC 9;4` 进度条**被处理（且是 tmux 自己渲染进度，不是转发给外层终端）。

结论（【源码证实(master/3.7c)】）：
- 在 tmux 内写裸 `OSC 777;…` 或 `OSC 99;…`：命中 `default`，**丢弃**（不报错、无可见乱码、也无通知）。
- 在 tmux 内写裸 `OSC 9;<文本>`：命中 `case 9` → `input_osc_9` 首字符不是 `4` → 直接 `return`，**丢弃**。
- 在 tmux 内写 `OSC 9;4;…`：会被 tmux 当成进度条消费（不会变成通知）。
- 这解释了生态实践：`pi-knock` 的注释称「tmux 3.4 不转发裸 OSC」；本轮源码证据把该经验升级为**逐条编号的确定性结论**。

#### tmux：DCS passthrough 的必要条件与「ESC 翻倍」的真实原因

`input_dcs_dispatch()`（3.7c / master 一致，原文摘录）：

```c
	const char prefix[] = "tmux;";
	…
	allow_passthrough = options_get_number(oo, "allow-passthrough");
	if (!allow_passthrough)
		return (0);                       /* 未开启：直接丢弃 */
	…
	if (len >= prefixlen && strncmp(buf, prefix, prefixlen) == 0) {
		screen_write_rawstring(sctx, buf + prefixlen, len - prefixlen,
		    allow_passthrough == 2);      /* 2 == 'all' */
	}
```

而 `screen_write_rawstring()` → `tty_cmd_rawstring()` 的实现是 `tty_add(tty, ctx->data.data, ctx->data.size)`（**原样写出，不做任何反转义**）【源码证实(master) `screen-write.c` / `tty.c`】。

关键细节——**为什么 payload 里的 ESC 必须写两遍**（这是本轮最有价值的新证据，前一轮与多数二手资料都只说「要翻倍」而没说清语义）：

DCS 的输入状态机：

```c
	/* dcs_handler state table. */
	{ 0x00, 0x1a, input_input, NULL },
	{ 0x1b, 0x1b, NULL, &input_state_dcs_escape },     /* 见到 ESC → 进入 dcs_escape */
	{ 0x1c, 0xff, input_input, NULL },
	/* dcs_escape state table. */
	{ 0x00, 0x5b, input_input, &input_state_dcs_handler },  /* ESC + 其它字节 → 只保留「其它字节」 */
	{ 0x5c, 0x5c, input_dcs_dispatch, &input_state_ground },/* ESC + \ → 结束 DCS */
	{ 0x5d, 0xff, input_input, &input_state_dcs_handler },
```

`input_input()` 的实现是 `ictx->input_buf[ictx->input_len++] = ictx->ch;`，即**只记录当前字节**。因此：

- 写 `ESC ESC`：第一个 `ESC` 只触发状态迁移（不记录），第二个 `ESC` 被记录 → payload 里恰好得到 **1 个 ESC**，外层终端收到的是合法序列。
- 写单个 `ESC` 后跟 `\`：DCS 被**提前结束**，payload 缺失，剩下的字节落到 ground 状态 → 外层终端收到**未终止的 OSC**（后续可见文本会被吞进 OSC，直到遇到下一个 BEL/ST）——这正是「撕裂/乱码」的具体机制。
- 写单个 `ESC` 后跟其它字节（如 `]`）：`ESC` 被**吃掉**，只留下 `]777;notify;…` → 外层终端收到的是**纯文本**，会在屏幕上出现可见乱码（例如 `]777;notify;pi guard;…`）。

因此：**「用 DCS 包装」不是可选项而是必需项；「ESC 翻倍」也不是可选项而是必需项**，且顺序上必须在「清理控制字符」之后做（若先翻倍再清理，`\x1b` 属于被清理的 C0 范围，翻倍会被清掉——见 A.4）。

版本差异与默认值：

| 事实 | 证据 |
| --- | --- |
| `allow-passthrough` 由 **tmux 3.3** 引入，**默认 off** | 【官方 CHANGES 证实】`CHANGES FROM 3.2a TO 3.3`：「Add an option (default off) to control the passthrough escape sequence.」 |
| **tmux 3.4** 增加第三态 `all`（不可见 pane 也允许） | 【官方 CHANGES 证实】原文：「Add a third state "all" to allow-passthrough to work even in invisible panes.」 |
| tmux 3.7c 的默认值仍是 `off`（`default_num = 0`），作用域 = window|pane，取值 `off|on|all` | 【源码证实(3.7c tag)】`options-table.c`；【源码证实(master)】同一处 |
| `off` = 不允许；`on` = 仅当 pane 可见；`all` = pane 不可见也允许 | 【文档证实】tmux(1) man page（master `tmux.1`，pane options 段，原文：`Allow programs in the pane to bypass tmux using a terminal escape sequence (\ePtmux;...\e\\)… If set to on, passthrough sequences will be allowed only if the pane is visible.`）；【源码证实】`options-table.c` 的 `.text` 同义 |
| **本机** `allow-passthrough = on`，来源是显式配置（`~/.tmux.conf.local` L13 `set -g allow-passthrough on`），**不是** tmux 内置默认 | 【本地文件证实】；【命令输出·未复核】（前一轮 `tmux show-options -gw` 得到 `on`） |

**「`on` 不够」是本报告对 pi-guard 最具体的一条影响**：pi-guard 的触发场景恰恰是「用户在别处、没盯着 Pi 的 pane」，此时 pane 很可能不可见 → `allow-passthrough on` 下 passthrough 被丢弃 → OSC 层静默失效（而又因为我们「命中后跳过 spawn 链」，就变成**什么都没发**）。要覆盖该场景，用户必须配置 `allow-passthrough all`（`pi-tmux-notify` 的 `checkPassthrough()` 正是为此发出警告）。

#### tmux 自己有没有通知机制

- **没有 OSC 通知**（见上，`777`/`99` 被丢弃，`9` 只做进度条）。
- 它有**内层提示**机制，全部在 tmux 界面内显示，不是 OS 通知：`bell-action`（默认 `ALERT_ANY`）、`visual-bell`（默认 `VISUAL_OFF`）、`visual-activity`（默认 off）、`monitor-bell`（默认 on）、`monitor-activity`（默认 off）、`activity-action`（默认 `ALERT_OTHER`）【源码证实(master/3.7c) `options-table.c`】；tmux 3.8 起 `OSC 133` 还可触发 `pane-command-started/finished`、`pane-shell-prompt` 等事件【官方 CHANGES 证实】。
- 对 pi-guard 的 BEL 兜底的含义：【推断】在 tmux 内 BEL 的可见效果取决于上述选项（可能只是把窗口标记为 bell 状态/状态栏提示），**不保证**外层终端响铃。【未证实】本轮未实测。

#### GNU screen

`screen` 5.0.2 的 `src/ansi.c`（Debian sources 原文，`StringEnd()`）：

```c
	case OSC:		/* special xterm compatibility hack */
		if (win->w_string[0] == ';' || (p = strchr(win->w_string, ';')) == NULL)
			break;
		typ = atoi(win->w_string);
		p++;
		if (typ == 83) { … /* 83 = 'S'：screen 私有「执行命令」序列 */ }
		if (typ == 0 || typ == 1 || typ == 2 || typ == 11 || typ == 20 || typ == 39 || typ == 49) {
			… SetXtermOSC(typ2, p, t); …        /* 只用于 screen 自身（标题/调色）→ 转写为外层序列 */
		}
		if (typ != 0 && typ != 2) break;        /* ← 其它编号（含 777/99）到此为止：丢弃 */
		…
	case DCS:
		LAY_DISPLAYS(&win->w_layer, AddStr(win->w_string));
		break;
```

结论（【源码证实】screen 5.0.2 `ansi.c`）：
- **`OSC 777` / `OSC 99` 在 screen 内被丢弃**，并且 `OSC 9`（typ=9 不在 0/1/2/11/20/39/49 里）**也被丢弃**。
- screen **没有** tmux 的 `allow-passthrough` 机制：本轮在 screen(1) man page 里检索 `passthrough`（以及 bell_msg/vbell/monitor 等）均未见同类开关；`ansi.c` 里也没有对应的 DCS 前缀判定【未证实：本轮未逐字读完 screen 全部源码，只读了 OSC/DCS 相关段落】。
- screen 的 DCS 分支把字符串内容交给显示层（`LAY_DISPLAYS(..., AddStr(win->w_string))`）：**理论上**可能是一条「把内容写给外层终端」的路径，但它写的是**去掉 `ESC P`/`ESC \` 帧之后的内容**，是否等于可用的 passthrough、以及是否会把 OSC 的 ESC 当纯文本打到屏幕上，**本轮未实测**→【未证实】。任何依赖它的设计都必须先在真实 screen 里验证「不产生可见乱码」。
- screen 自己的「通知」是**内部 message line**：`activity`（默认关闭监测，「Activity in window %n」）、`bell_msg`（「Bell in window %n」）、`silence`/`silencewait`、`defmonitor` 初始 off（screen(1) man page 原文）【文档证实】。BEL 的传递是 `WBell(win, visual_bell)`（【源码证实】`ansi.c` 的 `Special()`）→ 要么交给显示层响铃，要么（vbell 开）显示 `vbell_msg`。

### A.3 其他会吃掉 / 变形 OSC 的环境

| 环境 | 会不会破坏渲染或产生可见乱码 | 会不会丢通知 | 依据 |
| --- | --- | --- | --- |
| **Windows Terminal（`WT_SESSION`）** | 不会乱码（WT 自己解析 OSC） | 会：WT 的 OSC 777 支持**默认关闭**（需用户开 profile 设置），且聚焦时被抑制 | 【前一轮证据/PR 原文】：microsoft/terminal PR #20012「Updated default to `false`」+ 提交 `Suppress notification if focused`（引用于 `docs/research/pi-guard-notification-os-mechanisms.md`，本轮未重新抓取 PR） |
| **VS Code 集成终端** | 不会乱码 | 会（等于不支持）：VS Code 终端是 xterm.js，其官方《Supported Terminal Sequences》OSC 表**只有** `0/1/2/4/8/10/11/12/104/110/111/112`，**没有 9 / 99 / 777**；DCS 表也没有 passthrough 项；文档明说「Missing sequences are either not supported or unstable/experimental」，addon/integration 才能提供自定义序列（市面上确有 VS Code 扩展监听 OSC 777，属附加组件） | 【文档证实】xtermjs.org/docs/api/vtfeatures（xterm.js 6.0.0） |
| **SSH** | 不会乱码（SSH 只是字节流，不解析 OSC） | 取决于「客户端终端是否支持」，**而不是**服务端；真正的风险是**识别失效**：身份变量通常不随 ssh 转发（OpenSSH 客户端 `SendEnv` 默认空、服务端 `AcceptEnv` 默认空，发行版一般只接受 `LANG/LC_*`）→ 远端进程往往检测不到支持 | 【推断】+【未证实：本轮未抓取 ssh_config/sshd_config man page；一行 `ssh host env \| grep -E 'TERM_PROGRAM\|KITTY'` 即可验证】 |
| **`docker exec`** | 不会乱码 | 取决于 `-t`：未分配 TTY 时 `process.stdout.isTTY` 为 false（应被我们自己的门控挡掉）；分配 TTY 时 OSC 会原样传到宿主终端 | 【推断】（基于 pty 语义；未取 docker 文档原文） |
| **`script`** | 可能留下**原始转义字节**在 typescript 文件里（信息面：通知正文会被持久化到文件）；但输出仍透传到父终端，渲染正常 | 不丢 | 【推断】（`script` 复制 pty 字节流到 stdout + 文件；本轮未取 man page 原文） |
| **`tee`** | 不改字节、不过滤 ESC → 渲染正常，但 OSC 会被写入管道/文件 | 不丢 | 【推断】 |
| **`TERM=dumb`** | 由「终端」定义就是不具备高级能力；不应写任何转义 | 会 | 【推断】（按 dumb 语义；建议显式门控） |
| **非 TTY（重定向/管道/CI）** | 若是 print/json/rpc 模式，写 ESC 会**污染数据通道**（本仓库既有调研已覆盖） | 无意义 | 【本仓库既有调研】`docs/research/pi-guard-notification-os-mechanisms.md` D 节；本轮不重复 |
| **screen 内嵌 tmux / tmux 内嵌 screen** | 任一层的 `ESC` 语义都适用；外层若为 screen，内层 passthrough 也可能被丢弃 | 会 | 【推断】基于 A.2 两份源码 |

**「会不会产生可见乱码」的统一判据（本轮新增，源码级）**：乱码只在「DCS passthrough 里 ESC 没有翻倍」或「序列被拦腰截断（写非原子 / 多路复用器提前结束 DCS）」时出现；在 tmux/screen 里写**裸** OSC 不会乱码（被静默丢弃）。也就是说：**乱码风险来自我们自己的包装方式，而不是来自多路复用器本身**。

### A.4 可执行口径建议（「仅在检测到支持时才写」的定义）

建议把判定写成「**正向白名单命中 AND 全部排除项不命中**」。

**① 正向白名单（任一项命中才允许写 OSC）**

| 条件 | 对应终端/序列 | 证据 |
| --- | --- | --- |
| `KITTY_WINDOW_ID` 存在 | kitty → OSC 99（kitty 同时向后兼容 OSC 9） | 【前一轮证据 + 生态实现口径一致】`pi-tmux-notify`/`@jmcombs/pi-notify`/上游 `notify.ts` 都用它判 kitty |
| `TERM_PROGRAM === "ghostty"` 或 `GHOSTTY_RESOURCES_DIR` 存在 | Ghostty → OSC 9 或 777（官方两者都支持） | 【前一轮证据：Ghostty 官方文档】 |
| `TERM_PROGRAM === "WezTerm"` | WezTerm → OSC 9 或 777 | 【前一轮证据：WezTerm escape-sequences 官方文档】 |
| `TERM_PROGRAM === "iTerm.app"` 或 `ITERM_SESSION_ID` 存在 | iTerm2 → OSC 9 | 【前一轮证据：iTerm2 官方 escape codes】 |
| `TERM_PROGRAM === "WarpTerminal"` | Warp → OSC 777（生态里 `@juicesharp/rpiv-warp` 的做法） | 【registry 证实】`@juicesharp/rpiv-warp` 描述 + 前一轮源码证据 |
| `TERM` 前缀 `rxvt` | rxvt-unicode → OSC 777（777 的原始出处） | 【前一轮证据】 |

**② 必须排除的环境变量 / 条件（命中即放弃 OSC，退回 spawn 链）**

| 排除项 | 理由 | 代价 |
| --- | --- | --- |
| `TMUX`（或 `TERM_PROGRAM === "tmux"`、`TERM` 前缀 `tmux-`） | 裸 OSC 必被丢弃；要支持必须写 DCS passthrough + ESC 翻倍 + 用户 `allow-passthrough`（默认 off；`on` 对后台 pane 无效）；且 `TERM_PROGRAM` 已被覆写、其余身份变量可能过期 | **见下「覆盖率代价」** |
| `STY`（或 `TERM` 前缀 `screen`） | screen 丢弃 `777`/`99`/`9`，且无 passthrough 开关 | 同上（screen 用户更少） |
| `WT_SESSION` | 用户已决定不做 Windows toast；WT 的 OSC 777 默认关闭且仅在新版本可用；而 `WT_SESSION` 在 tmux/WSL 里还会透传 → 会把「Windows 路径」误判进来 | 放弃 WT 用户的 OSC（本来也基本不可用） |
| `TERM_PROGRAM === "vscode"` | xterm.js 不支持 OSC 9/99/777（官方序列表） | 放弃 VS Code 终端用户 |
| `TERM_PROGRAM === "Apple_Terminal"`、`TERM` 含 `alacritty` | 终端不支持 OSC 通知（前一轮证据 + 生态实现均排除） | 放弃这两类用户（它们回到 spawn 链） |
| `TERM === "dumb"` 或 `process.stdout.isTTY !== true` | 无解析能力 / 非交互 | 无损失（本就不该写） |
| `ctx.mode !== "tui"`、`!ctx.hasUI` | 既有约定（print/json/rpc 数据通道） | 无损失 |
| 白名单未命中（未知 `TERM_PROGRAM`） | 默认不安全，不写 | 未知终端退回 spawn 链 |

**③ 排除 tmux 的覆盖率代价（明确写出）**

- 本机就是反例：本机 Pi 运行在 tmux 内（`TERM_PROGRAM=tmux`、`TMUX=/private/tmp/tmux-501/default,32270,8`，【命令输出·未复核】），因此**在这台机器上 OSC 层永远不会触发**，本地验证/受益为零。
- 无法量化「Pi 用户中 tmux 占比」：【缺失证据】。可用的弱证据：`pi-tmux-notify` 周下载 43 次、`pi-notify`（OSC 版）周下载 129 次、`@juicesharp/rpiv-warp` 周下载 241 次【registry 证实，前一轮快照】——只说明「各终端专用通知扩展都有人用」，不能推出占比。
- 代价的**性质**：不是功能回归（spawn 链原样保留），而是「新增 OSC 层对 tmux 用户完全无效、且如果我们实现了「命中即跳过 spawn 链」，还要额外保证 tmux 下**不会**误判为命中」。

**④ 若将来要支持 tmux（列出代价，不推荐也不否定）**

- 必须实现：`TMUX` 存在时把序列包成 `ESC P tmux; <ESC 翻倍后的序列> ESC \`（【源码证实】前缀与 RAW 语义见 A.2）。
- 必须处理用户配置：`allow-passthrough` 默认 off；`on` 对不可见 pane 无效 → 想覆盖「用户切走」场景需要用户配 `all`（生态先例：`pi-tmux-notify` 检测到非 `all` 时提示）。
- 内层终端识别只能靠「幸存变量」（`KITTY_WINDOW_ID`/`ITERM_SESSION_ID`/`GHOSTTY_RESOURCES_DIR`/`WT_SESSION`）或**外部探测**：`tmux display-message -p '#{client_termname}'`（外层 TERM）与 3.8 新增的 `I` 格式修饰符（报告 client terminal 信息）【官方 CHANGES 证实：master CHANGES 提到 “the I modifier reports client terminal information”】——但**具体格式名与可用性本轮未验证**，且它是 `spawn` 探测（与「零依赖前置层」的定位冲突），另有 reattach 过期问题。
- 结论：支持 tmux 会把「~50 行零依赖前置层」升级为「依赖 tmux 配置 + 探测子进程 + 多层包装」的功能。

**⑤ 控制字符清理（硬约束，与已定决策一致）**

- 必做：写 OSC 前，对 `title`/`body` 一律先做「剥离 C0/DEL/C1 + 替换字段分隔符」，无论 `includeCommand` 是否为 true（代码里不存在「看起来安全就跳过」的分支）。
- 可照搬的具体口径（【源码证实】`pi-tmux-notify` 0.0.3）：
  ```ts
  function sanitize(text: string): string {
    // Strip control chars and OSC delimiters (; separates fields in OSC 777)
    return text.replace(/[\x00-\x1f\x07\x9c]/g, " ").replace(/;/g, ",")
  }
  ```
  它同时覆盖了 `ESC`(0x1b)、`BEL`(0x07)、`ST` 的第二字节 `\x9c`、以及 OSC 777 的分隔符 `;`。`@bacnh85/pi-notify` 的口径等价（去 C0/DEL + `;`→`,`）【前一轮源码证据】。
- 顺序（【推断】基于 A.2 的源码语义）：**先 sanitize → 再拼序列 → 最后（若在 tmux 内）做 ESC 翻倍与 DCS 包装**；反过来会让清理吃掉用于翻倍的 ESC。
- 反例（**不要照搬**）：`@jmcombs/pi-notify` 1.1.0 的 `notifyOSC777(title, body)` 直接把 title/body 拼进序列，源码中**没有任何** `replace`/sanitize【源码证实：unpkg 读取该文件并用 `sanitize`/`replace` 全文检索无命中】；上游 Pi 示例 `examples/extensions/notify.ts` 同样没有清理，也没有 tmux 包装【本地文件证实】。

---

## 2. 问题 B：有没有现成的库可以调用

### B.1 终端 OSC 通知方向：**没有**

**结论：没有现成库提供「发射 OSC 777/99（+ 终端能力检测）」的通用能力。** 现有实现分两类：① 应用级插件（Pi/opencode 扩展），② 只做别的事的库（如 OSC 9;4 进度条）。

检索记录（本轮 + 前一轮，均标注来源类型）：

| 检索动作 | 命中/结果 |
| --- | --- |
| 【registry 证实】`registry.npmjs.org/-/v1/search?text=osc 777`（本轮） | 头部命中是 **`@juicesharp/rpiv-warp`**（Pi 扩展，OSC 777 for Warp）与 **`pi-notify` 1.4.0**（Pi 扩展，OSC 777/99/9 + Windows toast）——都是**应用插件**，不是库 |
| 【registry 证实】`…?text=terminal osc notification`（本轮） | 命中 **`osc-progress` 0.3.4**（「Tiny TypeScript helper for OSC 9;4 terminal progress sequences」，是**进度条**库，MIT，非通知）与 **`opencode-terminal-bell-notifier` 0.2.0**（「Zero-dependency OpenCode plugin … via OSC 9」——openode 插件，不是库） |
| 【registry 证实】前一轮 `npm search "terminal notification"` / `"osc 777"` | 命中 pi-notify、pi-tmux-notify、@juicesharp/rpiv-warp、@bacnh85/pi-notify、@jmcombs/pi-notify、pi-knock、@ceski23/pi-notifications、@jc4649/notify、@juicesharp/rpiv-warp 等，**全是插件** |
| 【registry 证实】前一轮 `npm view <name>` 穷举 E404 | `terminal-notify`、`tnotify`、`term-notify`、`node-terminal-notify`、`osc-escapes`、`term-osc`、`iterm2-escape`、`node-iterm2`、`iterm2-cli`、`is-iterm2`、`term-program`、`terminal-detector`、`supports-terminal-notifications`、`terminal-notify-support`、`node-terminfo` 均不存在 |
| 【registry 证实】无关同名包（避免误判） | `osc`(0.4.5) / `node-osc` / `osc-min` 是 **Open Sound Control 音频协议**；`notifier`(0.2.0) 是**邮件发送**库；`node-pushnotifications`/`@parse/node-apn` 是 APNs/FCM |
| 【registry 证实】「终端识别」方向 | `detect-terminal` 3.0.0（MIT，0 依赖，520 KB 解包）只能回答「是哪个终端程序」，**不含**任何「能否弹通知/支持哪些 OSC」的能力表；`ansi-escapes`（MIT，1 依赖）是通用 ANSI 构造器，**不含 OSC 通知协议语义**；`supports-hyperlinks`/`is-unicode-supported` 与通知无关 |

补充说明（避免把「穷举」讲过头）：registry 搜索是**关键词排序**，不是完备枚举；上述结论的强度是「多种检索角度 + 名称穷举 + 生态源码逐包阅读」都指向同一个答案。**没有任何库**把「终端能力检测（含 tmux/screen 处置）+ OSC 777/99 发射 + 控制字符清理」封装起来；若自写，需要自己实现的部分约为：检测表（A.4 ①+②，~25 行）、序列构造（777 一行、99 两段，~10 行）、清理（3 行）、tmux/screen 处置（若支持则 ~10 行）、可注入的 write（1 行 `process.stdout.write`）。

### B.2 跨平台桌面通知方向：`node-notifier` 能否替代现有 spawn 链

（元数据均为【registry 证实】；行为均为【源码证实：unpkg 读取 `index.js`/`notifiers/*.js`/`lib/utils.js`】）

| 维度 | node-notifier 10.0.1 | 与 pi-guard 现状的差异 |
| --- | --- | --- |
| 版本 / 许可 | 10.0.1（`latest`）；包本体 MIT | 一致（pi-guard 也是 MIT） |
| 最后发布 | 该版本的发布元数据为 **2022-02-01**（`_npmOperationalInternal.tmp` 时间戳 1643748014354）；packument 的 `time.modified` 为 2026-06-29（元数据触碰，非发版） | **4 年多未发新版**：维护活跃度是选型风险 |
| 依赖 | 6 个运行时依赖：`uuid@^8.3.2`、`which@^2.0.2`、`growly@^1.3.0`、`is-wsl@^2.2.0`、`semver@^7.3.5`、`shellwords@^0.1.1` | pi-guard 现状是**零运行时依赖**；引入即扩大供应链面（安全插件尤其敏感） |
| 模块形态 | CJS（`main: index.js`，无 `type`、无 `exports`、无 `engines`、无自带 `.d.ts`，需 `@types/node-notifier`） | 仓库要求 ESM/Node≥20/严格 TS：可 `import notifier from "node-notifier"`（Node 的 CJS→ESM default 互操作），**但**没有具名导出、无类型；现实例证：`@pi-unipi/notify`（`type: module`）正是这样用的【源码证实】 |
| 捆绑二进制 | **是**：包内 `vendor/mac.noindex/terminal-notifier.app/…`（含 87 KB 可执行文件 + 369 KB icns + nib）、`vendor/snoreToast/snoretoast-x64.exe`(2.5 MB)、`x86.exe`(2.1 MB)、`vendor/notifu/notifu.exe`/`notifu64.exe`；另有 3 份独立 LICENSE（terminal-notifier / notifu / snoreToast） | 引入后：解包体积 +5.68 MB（其中 Windows 二进制约 4.8 MB 对 macOS/Linux 用户是死重）、**多许可证合规审查**、macOS 上会运行一个**来自 npm 包内的未 notarize 的 .app**（Gatekeeper/notarize 风险与「谁的签名」问题） |
| macOS 实现 | 使用**包内** terminal-notifier：`path.join(__dirname,'../vendor/mac.noindex/terminal-notifier.app/Contents/MacOS/terminal-notifier')`，可用 `customPath` 覆盖；走 `utils.fileCommandJson` → `cp.execFile(notifier, args, cb)`（**纯 argv，无 shell 插值**）；非 10.8+ 或失败时回退 Growl 或报错 | **优点**：无需用户 `brew install terminal-notifier`（pi-guard 现在首选它但用户常常没装）。**缺点**：用户失去「用自己的 terminal-notifier」的控制；包内 .app 的签名/公证状态未验证【未证实】 |
| Linux 实现 | 调用系统 `notify-send`（`which.sync` 判存在） | 与 pi-guard 的第 1 级一致；pi-guard 多了 `gdbus` 直连 D-Bus 的第 2 级 |
| Windows 实现 | SnoreToast（`vendor/snoreToast/snoretoast.exe`）/ 旧系统 Notifu | pi-guard 现状是「仅 BEL」；用户已决定**不纳入 Windows toast** → 该能力对 pi-guard 无价值，却仍需承担体积/许可/供应链成本 |
| 失败可探测性 | 有回调：`callback(err)`；`execFile` 的 error 会带上 stderr【源码证实】 | **不等价于现有降级链**：① 无逐级降级（node-notifier 内部只有 macOS Growl/Notifu 之类有限回退）；② **没有超时**——`cp.execFile(notifier, options, cb)` 未传 `timeout`，通知服务挂起时子进程会长期残留，而 pi-guard 现有实现有 `NOTIFY_TIMEOUT_MS = 5_000` + `SIGKILL`；③ pi-guard 的 `runNotifyCommand` 用**退出码**判定成功（`close(code === 0)`），node-notifier 把退出码语义收敛成一个 Error，且其 `utils.command()` 路径会经 `shellwords.escape()`+shell（【源码证实·部分】只读到 escape 行） |
| `-group` 去重 / 诊断 | 未在 API 表面暴露 pi-guard 现在用的 `-group pi-guard` 与 `-diagnose` 语义的等价物（macOS 路径通过 `mapToMac` 映射有限选项）【源码证实·部分】 | pi-guard 现在的 `-group` 天然去重会丢失 |
| 结论（只陈述事实差异） | 它把「三平台各自 spawn」收敛成一次函数调用，并让 macOS 免安装；代价是 CJS+6 依赖+5.68 MB+多许可+无超时+降级语义弱化 | **不替用户决定**：是否接受以上代价，取决于是否愿意用「体积/供应链/控制力」换「API 简洁 + macOS 免安装」 |

### B.3 Pi 生态内的既有实现：哪些值得照搬

（下表除标注外均为本轮【源码证实】，通过 unpkg 读取已发布包源码）

| 包 | 检测口径 | 序列写法 | 控制字符处理 | 可否照搬 |
| --- | --- | --- | --- | --- |
| **pi-tmux-notify 0.0.3** | `KITTY_WINDOW_ID \|\| TERM_PROGRAM=kitty \|\| TERM 含 kitty` → OSC 99；`GHOSTTY_RESOURCES_DIR \|\| TERM_PROGRAM ∈ {ghostty,wezterm,iterm.app} \|\| TERM 含 rxvt` → OSC 777；否则 OSC 9 | `\x1b]99;i=pi:d=0;{t}\x1b\\` + `\x1b]99;i=pi:d=1:p=body;{b}\x1b\\`；`\x1b]9;{t}: {b}\x07`；`\x1b]777;notify;{t};{b}\x07`；`TMUX` 存在时 `\x1bPtmux;` + `replace(/\x1b/g,"\x1b\x1b")` + `\x1b\\` | ✅ `sanitize()` 去 `[\x00-\x1f\x07\x9c]` 并把 `;`→`,` | **最值得照搬**：检测表、三种序列、ESC 翻倍 + `allow-passthrough` 检查（已实现「提示用户需要 `all`」）、`/dev/tty` 写入 + stdout 回退、只读 `ctx.mode !== "tui"` 就禁用 |
| **@jmcombs/pi-notify 1.1.0** | `win32 && !WT_SESSION` → 不支持；`TERM_PROGRAM=Apple_Terminal` → 不支持；`TERM` 含 `alacritty` → 不支持；`KITTY_WINDOW_ID` → OSC 99；`TERM_PROGRAM=ghostty` → OSC 9；`iTerm.app \|\| ITERM_SESSION_ID` → OSC 9；默认 OSC 777 | `wrapForTmux()`：`!TMUX` 直写，否则 `ESC P tmux;` + `split(ESC).join(ESC+ESC)` + `ST`；OSC 777 用 BEL、OSC 99 用 ST、OSC 9 用 BEL | ❌ **完全没有**清理（`sanitize`/`replace` 全文无命中）；OSC 99 分两段**分别** `process.stdout.write`（两次写，非原子） | **检测口径与 tmux 包装可参考**；**控制字符处理是反面教材**（违反本任务硬约束）；另外它明确「不支持时只 `ctx.ui.notify` 提示、不 spawn 系统进程」，与 pi-guard「保留 spawn 链」的决策不冲突但需注意不要照抄「不支持就不发」 |
| **@zzxb/pi-notify 0.0.1** | 无终端检测（**不是 OSC 实现**） | 无 OSC：调用外部 helper（`runHelper(pi, ctx, "Show", ["-Title", …, "-Subtitle", …, "-Body", …, "-SessionKey", …])`），并 `ctx.ui.setTitle(...)` 改标题 | N/A（helper 内） | 不可照搬；对 pi-guard 的参考价值：它把「标题栏 + 任务栏图标 + BEL」当组合手段（用户已决定不做 Windows toast） |
| **@yuru7/pi-native-notify 0.4.0** | 只做**环境**判定：`win32`/`darwin`/`linux`+WSL 探测（`WSL_DISTRO_NAME`/`WSL_INTEROP` 或读 `/proc/sys/kernel/osrelease`）；**不做终端能力检测**（无 OSC） | 无 OSC；`osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' -e 'end run' <msg> <title>`（macOS）、`notify-send`（Linux）、PowerShell（Windows） | 依赖 OS 侧 argv 传递（macOS 用 `on run argv`，**与 pi-guard 现有 macOS 降级链写法完全一致**） | **作为「独立实现佐证」很有价值**：它验证了「`osascript` + `on run argv` 免插值」这条路径在生态里也被采用；`spawnDetached` 的 `{detached:true, stdio:"ignore", windowsHide:true}` + `ENOENT` 一次性告警，与 pi-guard 的 `runNotifyCommand` 同构（差别：它不做退出码判定/超时/SIGKILL） |
| **@pi-unipi/notify 2.20.5** | 不做终端检测；Windows-only 焦点探测（`platforms/focus.ts` 只有 `win32` 分支，macOS/Linux 留 TODO） | 无 OSC；`node-notifier` 的 `notifier.notify({title,message,appID}, cb)`，用 Promise 包一层；另有 Gotify/Telegram/ntfy | 未做（交给 node-notifier） | 参考价值：**它是本报告里唯一实际采用 `node-notifier` 的 Pi 生态实现**，可作为「node-notifier 在 Pi 插件里能跑通」的实证；也可看到它的失败处理比 pi-guard 弱（无降级链、无超时；把 `callback(err)` 直接 reject） |
| **pi-knock 0.1.0 / pi-notify 1.4.0 / @bacnh85/pi-notify** | 前一轮证据：`WT_SESSION→windows / KITTY_WINDOW_ID→OSC99 / 默认 OSC777`（pi-knock、@jc4649、pi-notify 同构），pi-tmux-notify 另有一套映射 | 前一轮证据：`\x1b]777;notify;t;b\x07`、两段式 OSC 99、tmux DCS 包装 | `@bacnh85/pi-notify` 有 `sanitizeOsc`（去 C0/DEL + `;`→`,`）；**pi-notify 1.4.0 / pi-knock 只是去 `\r\n\x07`**（不完整） | 检测口径可对照；序列写法大同小异（OSC 777 一律 `;` 分隔 + BEL，OSC 99 一律两段 + ST） |
| **上游 `examples/extensions/notify.ts`（Pi 0.87.1）** | `WT_SESSION` → PowerShell toast；`KITTY_WINDOW_ID` → OSC 99；否则 OSC 777（**无 tmux 处理、无清理**） | `process.stdout.write('\x1b]777;notify;${title};${body}\x07')`；OSC 99 两段式 | ❌ 无 | 只能作为「上游容忍直写 stdout」的证据；**不能作为安全实现模板**（title/body 来自调用方，未清理）【本地文件证实】 |

**共性归纳（【源码证实】）**：6 个 OSC 实现里，OSC 777 写法完全一致（`\x1b]777;notify;t;b\x07`）、OSC 99 一律两段式（`i=<id>:d=0` 标题 + `i=<id>:p=body` 正文，ST 结尾）、tmux 包装一律 `ESC P tmux;` + ESC 翻倍 + `ESC \`；差异集中在**检测表**与**是否清理控制字符**。

### B.4 对照：其他 CLI 怎么处理同一问题，是否处理 tmux

| 工具 | 机制 | 为什么不直写 stdout | 对 tmux 的处理 | 证据等级 |
| --- | --- | --- | --- | --- |
| **Claude Code** | hooks 返回 `terminalSequence` 字段，**由宿主代写**；白名单只允许 `OSC 0/1/2/9/99/777` 与裸 BEL，其它（CSI 光标/颜色、OSC 8、OSC 52、OSC 1337）整字段忽略；仅交互式会话且界面在屏时生效 | 官方原文：hooks 没有控制终端，「writing escape sequences directly to `/dev/tty` fails」，交给宿主写才 **race-free** | 官方明确「**works inside tmux and GNU screen**」——由宿主在自己的写路径里处理（即宿主知道自己被多路复用器包着，可以决定包装方式） | 【前一轮证据：code.claude.com/docs/en/hooks 原文，本轮未重取】 |
| **Codex CLI** | 独立系统通知进程（WSL 下 PowerShell toast） | 走 OS 通知而非终端转义 | 本轮未取到 Codex 对 tmux 的显式处理证据 | 【前一轮证据】+【未证实：tmux 处理】 |
| **opencode** | 核心机制未证实；生态侧存在插件 `opencode-terminal-bell-notifier`（描述：「Zero-dependency OpenCode plugin that sends desktop notifications via **OSC 9** terminal escape sequences」） | 未证实 | 前一轮证据里有一条 Warp issue「Warp notifications silently stop firing when opencode runs inside tmux」——说明「跑在 tmux 里通知失效」是真实且已被用户报告的问题 | 【registry 证实】（插件描述）+【前一轮搜索命中】（Warp issue，未逐字核验） |
| **gemini-cli** | 官方有实验性 notifications 文档 + 扩展生态（`gemini-notifier` 等） | 未证实 | 未证实 | 【前一轮证据】+【未证实】 |
| **aider** | 独立系统通知进程（terminal-notifier → AppleScript；notify-send/zenity；PowerShell） | 走 OS 通知 | 未证实 | 【前一轮证据】 |

**对本任务的意义（【推断】）**：「不直写 stdout，交给宿主 / 交给 OS 进程」是主流选择，但这**不是**因为「直写 OSC 一定出错」，而是因为：① 宿主写能保证与渲染管线原子性；② 宿主**知道自己在不在多路复用器里**，从而能正确决定包装与协议；③ 扩展/插件直写时无法获得失败反馈。pi-guard 属于「插件直写」这一类，而它自己的触发场景（等待确认框）恰好又最可能在 tmux/WT 下发生。

---

## 3. 推荐口径与候选库（只陈述选项、代价与证据）

**口径选项**

- **选项 1：OSC 层只在「非 tmux/screen、非 WT/vscode、白名单命中、tui+TTY」时写**（即 A.4 的①+②）。
  - 代价：tmux/screen 用户（含本机）永远走 spawn 链，OSC 层对他们零收益；实现~40 行，无新依赖。
  - 证据支持：A.2 的 tmux/screen 源码结论、A.3 的 xterm.js 序列表、A.1 的 `TERM_PROGRAM` 覆写与过期风险。
- **选项 2：选项 1 + 支持 tmux（DCS passthrough）**。
  - 额外代价：ESC 翻倍的实现与测试；依赖用户 `allow-passthrough`（默认 off；要覆盖「切走后」场景须 `all`）；内层终端识别只能靠幸存变量或 `tmux display-message -p '#{client_termname}'` 探测（格式名【未证实】）；reattach 过期风险。
  - 证据支持：`pi-tmux-notify` 的完整参考实现（含 `all` 检查）【源码证实】。
- **选项 3：不做 OSC，只把 BEL 门控 + spawn 链做扎实**（即维持 0.84.2 基线的结论）。
  - 代价：放弃 OSC 的「零依赖、不经 OS 通知中心」收益；收益：实现/维护面最小，与本次所有源码证据都不冲突。
- **选项 4（与库相关）：把桌面通知层换成 `node-notifier`**。
  - 收益：API 收敛、macOS 免安装（包内 terminal-notifier）。
  - 代价：6 依赖 + 5.68 MB 解包（含约 4.8 MB Windows 二进制，而用户已决定不做 Windows toast）+ 3 份第三方 LICENSE + 无超时 + 无逐级降级/退出码语义 + CJS/无自带类型 + 2022 年后再无发版。
  - 证据支持：B.2 全表。

**候选库**

- 终端 OSC + 检测方向：**无候选**（B.1）。可参考实现：`pi-tmux-notify`（检测表 / 序列 / DCS 包装 / 清理），但它是**插件**不是库，照搬代码等于把它那 ~120 行搬进 pi-guard 并自行维护（注意其 MIT 许可与署名礼节）。
- 跨平台桌面通知方向：**`node-notifier` 10.0.1**（唯一现实候选，见 B.2）；`notifier`/`node-pushnotifications`/`@parse/node-apn` 与该场景无关。
- 终端能力探测方向：**无候选**——`detect-terminal` 只能识别终端程序名，不含通知能力表；`supports-hyperlinks`/`is-unicode-supported` 与通知无关；OSC 能力只能自己维护白名单（A.4 ①）。

---

## 4. 矛盾点

1. **本机 `allow-passthrough = on` 与默认值**：前一轮证据认为「可能是 3.7c 内置默认」，本轮在 `~/.tmux.conf.local` L13 找到显式 `set -g allow-passthrough on`，且 3.7c `options-table.c` 的 `default_num = 0` → **默认仍是 off，本机是显式配置**。（已纠正前一轮推断。）
2. **在 tmux 内是否「裸 OSC 会被转发」**：多份二手资料（vtdn.dev 等）与生态注释（`pi-knock`：tmux 3.4 不转发裸 OSC）说法不一；本轮以 tmux 3.7c 源码为准：**不转发**（`default` 分支丢弃），只有 DCS passthrough 一条路。
3. **`node-notifier` 的「最后发布」口径**：版本元数据是 2022-02-01，packument `time.modified` 是 2026-06-29。两者含义不同，不能混用。
4. **`@zzxb/pi-notify` 的形态**：任务前提称其含「terminal-signals」，但已发布 0.0.1 的源码里没有任何 OSC/终端序列逻辑（是 Windows helper toast 扩展）。
5. **Claude Code 声称「在 tmux 与 GNU screen 内可用」vs 本报告「screen 丢弃 OSC 777/99」**：不矛盾——Claude Code 的宿主可写**任意**白名单序列（例如 tmux 内用 DCS 包装、或用 screen 兼容的 `OSC 0/2` 类字节），且宿主知道自己在什么环境里；这与「screen 会把 `777/99` 丢弃」并存。但**screen 具体怎么让通知生效**，本轮没有证据（Claude Code 文档措辞未展开）。

## 5. 缺失证据 / 待验证清单

1. 【未证实】screen 是否覆写 `TERM_PROGRAM`/清理身份变量（未读 screen 的环境处理源码）。
2. 【未证实】screen 的 DCS → `LAY_DISPLAYS(AddStr(...))` 路径是否等价于一条 passthrough（未实测）；任何依赖它的设计必须先实测「不产生可见乱码」。
3. 【未证实】`tmux display-message -p '#{client_termname}'` 是否可用、以及 3.8 `I` 格式修饰符的确切用法（CHANGES 只提到该修饰符存在）。
4. 【未证实】`WT_SESSION` 是否在 WSL 内、以及在 tmux 内的实际传递情况（本轮只能证明 tmux 没有清理逻辑）。
5. 【未证实】VS Code 是否设置 `TERM_PROGRAM=vscode`（xterm.js 序列表已证实其终端**不支持** OSC 9/99/777，但「变量名」本身未取到一手来源）。
6. 【未证实】`script(1)` 的 typescript 文件是否原样记录 OSC 字节；`docker exec -t` 的 TTY 分配细节（本轮为推断）。
7. 【未证实】node-notifier 包内 `terminal-notifier.app` 的签名/公证状态；`utils.command()` 路径到底用 `cp.exec` 还是其它（只读到 `shellwords.escape(notifier)` 一行）。
8. 【未实测】本轮没有任何端到端实测（无 shell 工具，且任务禁止运行）。所有「是否真的弹通知 / 是否乱码」的结论都来自源码与文档，**必须由后续实测确认**（建议见 Next steps）。
9. 【缺失数据】Pi 用户中 tmux/screen 的占比（无法量化排除 tmux 的覆盖率代价）。
10. 【未核实】前一轮证据中的本机环境变量输出（`TERM_PROGRAM=tmux`、`KITTY_WINDOW_ID` 为空、`ITERM_SESSION_ID` 存在等）——本轮无 shell，未能独立复核（唯一交叉验证是 dotfile 原文）。

---

## 6. Sources

### Kept（按重要性）

- **tmux `input.c`（3.7c tag 与 master）**（https://raw.githubusercontent.com/tmux/tmux/3.7c/input.c、https://raw.githubusercontent.com/tmux/tmux/master/input.c）— OSC 分派表（777/99 无分支、9→仅 9;4）、`input_dcs_dispatch` 的 `tmux;` 前缀与 `allow-passthrough` 检查、`input_state_dcs_escape_table` + `input_input()` 决定「ESC 必须翻倍」。**本报告 A.2 的核心证据。**
- **tmux `options-table.c`（3.7c / master）**（https://raw.githubusercontent.com/tmux/tmux/3.7c/options-table.c）— `allow-passthrough` 默认 0（off）与三态语义、`update-environment` 默认列表（证明身份变量不会在 attach 时刷新）、`bell-action`/`visual-bell`/`monitor-bell` 默认值。
- **tmux `CHANGES`（master、3.3、3.5、3.6 tag）**（https://raw.githubusercontent.com/tmux/tmux/master/CHANGES 等）— 3.3 引入 `allow-passthrough`（default off）并「Export TERM_PROGRAM and TERM_PROGRAM_VERSION」；3.4 增加 `all`；3.8 的 `I` 格式修饰符。
- **tmux(1) man page 源（master `tmux.1`）**（https://raw.githubusercontent.com/tmux/tmux/master/tmux.1）— `allow-passthrough` 的 off/on/all 语义与 `\ePtmux;…\e\\` 形式。
- **tmux `screen-write.c` / `tty.c`（master）**（https://raw.githubusercontent.com/tmux/tmux/master/screen-write.c、…/tty.c）— `screen_write_rawstring` → `tty_cmd_rawstring` 是**原样写出**（无反转义），佐证「翻倍由输入侧处理」。
- **GNU screen 5.0.2 `src/ansi.c`**（https://sources.debian.org/data/main/s/screen/5.0.2-1/ansi.c）— `StringEnd()` 的 OSC 白名单编号与 `default break`（777/99/9 全丢）、DCS → `LAY_DISPLAYS(AddStr(...))`、`Special()` 的 BEL → `WBell`。
- **screen(1) man page**（https://man7.org/linux/man-pages/man1/screen.1.html）— `activity` / `bell_msg` / `silence` / `defmonitor` 均为**界面内 message line**；未见 passthrough 类开关。
- **xterm.js《Supported Terminal Sequences》6.0.0**（http://xtermjs.org/docs/api/vtfeatures）— OSC 支持表只有 0/1/2/4/8/10/11/12/104/110/111/112 → VS Code 集成终端不支持 OSC 9/99/777。
- **npm registry HTTP JSON**（https://registry.npmjs.org/{node-notifier,detect-terminal,@zzxb%2Fpi-notify,pi-tmux-notify,@yuru7%2Fpi-native-notify,@pi-unipi%2Fnotify}/latest）— 版本/许可/依赖/体积/发布元数据。
- **unpkg 文件清单与源码**（https://unpkg.com/node-notifier@10.0.1/?meta、…/lib/utils.js、…/notifiers/notificationcenter.js、https://unpkg.com/pi-tmux-notify@0.0.3/extensions/index.ts、https://unpkg.com/@jmcombs/pi-notify@1.1.0/index.ts、https://unpkg.com/@yuru7/pi-native-notify@0.4.0/extensions/{notifier,environment,notifiers/macos}.ts、https://unpkg.com/@pi-unipi/notify@2.20.5/platforms/{native,focus}.ts）— 捆绑二进制清单、无超时的 `execFile`、各生态实现的检测/序列/清理口径。
- **npm registry search API**（https://registry.npmjs.org/-/v1/search?text=osc%20777、…?text=terminal%20osc%20notification）— 证明「OSC 通知只有插件、没有库（`osc-progress` 只是 9;4 进度）」。
- **本机文件**：`plugins/pi-guard/src/notify.ts`、`plugins/pi-guard/package.json`（零运行时依赖）、`~/.tmux.conf`、`~/.tmux.conf.local`（L13 `set -g allow-passthrough on`）、Pi 0.87.1 的 `examples/extensions/notify.ts`。
- **仓库既有调研**（只引用不重复）：`docs/research/pi-notification-delivery-api.md`（0.87.1 无通知投递 API；上游把通知交给扩展）、`docs/research/pi-guard-notification-os-mechanisms.md`（0.84.2 基线，其 D 节「不要在插件里直写 OSC」的依据在本报告 A.2/A.3 被更新为「可写，但必须门控 + 清理 + 处置 tmux/screen」）、`docs/research/rpiv-ask-user-question-attention-signals.md`（生态四类做法）。

### Rejected / deprioritized

- **vtdn.dev / tmuxai.dev / webssh.net / software-dc.com 等 OSC/passthrough 二手教程** — 与 tmux 源码冲突或无法定位到规范原文；一律让位于源码。
- **各 LLM 搜索摘要**（例如「tmux 3.6a 是当前版本」「xterm.js 支持 OSC 777」）— 与 registry/源码直读冲突，已弃用（VS Code 那条尤甚：搜索摘要说支持，官方序列表说不支持）。
- **`@zzxb/pi-notify` 的搜索/关键词描述** — 与包内源码不符（无 OSC 代码）。
- **`npm view <name>` 的 `time.modified` 作为「最后发布时间」** — 口径错误，已改用版本自身的发布元数据。
- **`osc`/`node-osc`/`notifier`/`node-pushnotifications`** — 与终端通知无关（音频 OSC / 邮件 / 移动推送），仅作为「同名陷阱」记录。

---

## 7. Next steps

1. **在本机做一次「一次写、逐层观察」的实测**（不访问网络、不改仓库代码）：在 tmux 内 `printf '\e]777;notify;t;b\a'`（应无任何反应）→ 再试 `printf '\ePtmux;\e\e]777;notify;t;b\a\e\\'`（在 `allow-passthrough on` + pane 可见时应弹通知）→ 再把 pane 切到后台重试（预期**不弹**，验证「`on` 对不可见 pane 无效」）。同时记录 `ESC` 未翻倍时屏幕是否出现 `]777;…` 可见乱码。
2. **在 GNU screen 里重跑第 1 步**（含 DCS 包装版本），确认 screen 是否真的丢弃、以及 DCS 路径是否会产生可见乱码。
3. **验证两条识别补充路径**：`tmux display-message -p '#{client_termname}'` 的输出，以及 tmux 3.7c 内 `KITTY_WINDOW_ID`/`ITERM_SESSION_ID` 是否随 reattach 过期（切换终端 reattach 后 `env | grep`）。
4. **回归样本**（不访问网络）：给 `notify.ts` 的 OSC 层写单测样本——标题/正文含 `\x07`、`\x1b`、`\n`、`;`、`\x9c`、以 `-`/`[` 开头——断言①清理后不含任何 C0/C1；②tmux 分支下每个 `\x1b` 都出现偶数次且整体形如 `\x1bPtmux;…\x1b\\`；③非白名单环境**不产生任何 write**。
5. **决策后再验证 `node-notifier`（若考虑选项 4）**：在 Node 20 + ESM 下 `import notifier from "node-notifier"` 的可用性、`customPath` 指向系统 `terminal-notifier` 是否绕过「包内未公证 .app」，以及它在通知服务挂起时的子进程行为（是否真的没有超时）。

---

## Supervisor coordination

本轮无需决策或澄清；未遇到阻塞。需要说明的一点环境限制：本子代理没有 shell 工具，因此无法按要求重跑 `npm view` / 本机 `env`，已改用同源的 registry HTTP + unpkg 源码 + dotfile 原文完成抽样复核，并在报告开头与第 0 节显式披露。结论与残留风险直接返回，未向 supervisor 发送额外消息。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已按要求产出完整调研报告（中文，写入指定路径），回答了问题 A（tmux/screen 对 OSC 方案的影响，含身份变量透传、OSC 透传行为与版本差异、其他环境逐项、可执行口径建议与覆盖率代价）与问题 B（终端 OSC 方向无现成库及检索证据、node-notifier 逐维评估、Pi 生态四类实现对照与代码片段、其他 CLI 对照），末尾给出「推荐口径与候选库」只陈述选项/代价/证据，并列出矛盾点、缺失证据与来源分类。"
    }
  ],
  "changedFiles": [
    "docs/research/pi-guard-terminal-notification-library-survey.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read（.pi/skills/research/SKILL.md、/tmp/pi-notify-libs-evidence.md、Pi 0.87.1 examples/extensions/notify.ts、plugins/pi-guard/src/notify.ts 与 package.json、~/.tmux.conf、~/.tmux.conf.local、既有 docs/research 报告）",
      "result": "passed",
      "summary": "前置资料与本地文件复核完成；从 ~/.tmux.conf.local L13 找到 set -g allow-passthrough on，纠正前一轮「可能是 tmux 内置默认」的推断"
    },
    {
      "command": "fetch_content / get_search_content（tmux 3.7c 与 master 的 input.c、options-table.c、screen-write.c、tty.c、CHANGES、tmux.1；GNU screen 5.0.2 ansi.c 与 screen(1) man page；xterm.js Supported Terminal Sequences）",
      "result": "passed",
      "summary": "取到 A 题的源码级证据：tmux OSC 分派表丢弃 777/99、9 仅 9;4、DCS passthrough 的 tmux; 前缀与 allow-passthrough 检查、ESC 必须翻倍的输入状态机证明；screen 丢弃 777/99/9 且无 passthrough 开关"
    },
    {
      "command": "fetch_content（registry.npmjs.org /latest 与 -/v1/search、unpkg ?meta 与包源码：node-notifier、detect-terminal、@zzxb/pi-notify、pi-tmux-notify、@yuru7/pi-native-notify、@pi-unipi/notify、@jmcombs/pi-notify）",
      "result": "passed",
      "summary": "完成 B 题证据：node-notifier 捆绑 terminal-notifier.app/SnoreToast/Notifu 与 3 份 LICENSE、execFile 无超时；OSC 通知方向无库；生态实现检测口径与清理行为逐个核对"
    }
  ],
  "validationOutput": [
    "问题 A 结论：裸 OSC 777/99 在 tmux 3.7c 中命中 input_exit_osc 的 default 分支被丢弃，OSC 9 只被当作 9;4 进度条；唯一通路是 ESC P tmux; <ESC 翻倍> ESC \\ 的 DCS passthrough，需 allow-passthrough（默认 off，on 对不可见 pane 无效，本机为 .tmux.conf.local 显式 on）；tmux 3.3 起覆写 TERM_PROGRAM/TERM_PROGRAM_VERSION 为 tmux，update-environment 默认不含任何终端身份变量（reattach 后陈旧）",
    "问题 A 结论（screen）：screen 5.0.2 StringEnd() 的 OSC 白名单为 0/1/2/11/20/39/49，777/99/9 走 default break 被丢弃；DCS 分支 LAY_DISPLAYS(AddStr(...)) 是否等价 passthrough 未实测；screen 的通知机制是界面内 message line（activity/bell_msg/silence）",
    "问题 B 结论（库）：终端 OSC 通知方向没有现成库（registry 搜索命中全为应用插件；唯一的库 osc-progress 只做 OSC 9;4 进度）；跨平台方向唯一现实候选是 node-notifier 10.0.1（MIT、6 运行时依赖、CJS 无自带类型、解包 5,677,839 B 含 macOS/Windows 捆绑二进制与 3 份第三方 LICENSE、版本发布于 2022-02-01、execFile 未传 timeout）",
    "安全性结论：pi-tmux-notify 的 sanitize（[\\x00-\\x1f\\x07\\x9c] 去控制字符 + ; 替换）+ ESC 翻倍 + /dev/tty + allow-passthrough all 检查值得照搬；@jmcombs/pi-notify 1.1.0 与上游 examples/extensions/notify.ts 对 title/body 完全无控制字符清理，违反本任务硬约束，不可照搬"
  ],
  "residualRisks": [
    "本轮无 shell 工具，无法重跑 npm view / env / tmux show-options，也无法做任何端到端实测；A 题的「是否真的弹通知/是否乱码」结论来自源码与官方文档，需按 Next steps 实测确认",
    "tmux 相关源码证据取自 3.7c tag 与 master（报告内已区分，版本漂移风险已被 tag 复核消除，但本轮未逐字核对 3.7c 的每处行号）",
    "screen 的 DCS → AddStr 路径、screen 是否覆写 TERM_PROGRAM 均未证实，任何依赖它的设计必须先实测",
    "VS Code 的 TERM_PROGRAM=vscode、SSH 的 SendEnv/AcceptEnv 默认值、script/docker exec 的字节行为均标注为推断或未证实",
    "node-notifier 包内 terminal-notifier.app 的签名/公证状态与 utils.command() 的 shell 路径未完全核实",
    "Pi 用户中 tmux/screen 占比缺失，排除 tmux 的覆盖率代价只有弱证据（npm 周下载量），无法给出比例",
    "仅新增一份 docs/research 报告，未修改 plugins/ 任何文件，未安装/构建/运行测试"
  ],
  "noStagedFiles": true,
  "diffSummary": "新增中文调研报告 docs/research/pi-guard-terminal-notification-library-survey.md（tmux/screen 对 OSC 方案的影响、其他环境逐项、可执行白名单/排除口径与覆盖率代价、现成库评估与生态实现对照、推荐口径与候选库、矛盾点与未证实清单、来源分类、下一步实测建议）",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "两处对前一轮证据的纠正已写入报告第 0 节：(1) 本机 allow-passthrough=on 来自 ~/.tmux.conf.local L13 显式配置，而非 tmux 3.7c 内置默认（3.7c options-table default_num=0）；(2) @zzxb/pi-notify 已发布 0.0.1 内没有任何 OSC/terminal-signal 代码，它是调用外部 Windows helper 的 toast 扩展——任务前提中的「@zzxb/pi-notify 的 terminal-signals」在已发布包中不存在。另澄清 node-notifier 的「最后发布」口径（该版本 2022-02-01，packument time.modified 2026-06-29）。最有决策价值的新证据：tmux 3.7c input.c 的 dcs_escape 状态表证明「payload 内单个 ESC 会被吃掉、ESC+\\ 会提前结束 DCS」，因此 ESC 翻倍不是可选优化而是必需项；以及 allow-passthrough on 对不可见 pane 无效——正好覆盖 pi-guard 的目标场景（用户已切走）。"
}
```

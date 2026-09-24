---
status: accepted
---

# 自动命名会话的口径：语言跟随、具体性优先、按脚本分别计长

`@lystran/pi-session-rename` 的标题请求此前只发一条 user 消息，把三条英文指令与用户首句混在同一层，且完全没有语言约束。实测结果是两个失败模式同时出现：中文提问得到英文标题（`你看看 pi-serena-hooks 插件，好想有挺多问题的` → `Serena Hook Edit Resend Bug`），以及泛化到记不住的标题（`我想把这个仓库弄成我专门用于编写pi coding agent插件的一个仓库` → `初始化项目`）。对照同一提示词下的成功样本（`oauth2.0 的工作原理是什么？openid呢？` → `OAuth 2.0 与 OpenID`）可以看出根因不在模型：**首句里含有可直接摘取的具体名词时模型摘对了，口语长句则退回最泛化的概括**，而语言跟随在两种情况下都纯属随机。

因此把约束从 user 消息迁到 system 角色，并按上游一手证据逐条补齐：语言跟随采用 Claude Code 的 `in the language the user wrote in, not the language of these instructions`（后半句是必需的，因为指令本身是英文）；具体性采用「祈使动词 + 紧跟具体对象」；长度按脚本分别给预算。

> 实现状态：已实现（`plugins/pi-session-rename/src/title.ts` 的 `buildTitleSystemPrompt` / `buildTitlePrompt` / `buildRetryTitlePrompt` / `generateTitle`，测试与 README、changeset 同步）。
> 证据来源：`docs/research/pi-session-rename-prompt.md`（含 11 家上游提示词逐字原文与证据等级）、`docs/research/pi-session-rename.md`。基线为 Pi coding agent 0.87.1 / pi-ai 0.87.1；下文一律引用符号名（`Context.systemPrompt`、`StreamOptions.cacheRetention`）而不是行号，因为行号会随版本漂移。

## Considered Options

- **保持单条 user 消息，只把指令文本改好**。否决理由：上游 5 家（Claude Code、OpenCode 的隐藏 `title` agent、Codex 的临时结构化线程、Zed 的 `SUMMARIZE_THREAD_PROMPT`、以及同类 Pi 插件的 `systemPrompt`）全部把指令放在 system 侧或专用 agent prompt 里，只有本插件混在同一层；而 `Context.systemPrompt` 是公开 API，改一行就能拿到 system 角色。
- **采用 Claude Code 的「标题绝不以动词开头，用名词短语」**。否决理由：Codex CLI 要求相反（`Start with an imperative verb`），两者不可能同时写。选祈使动词一侧，因为中文里「名词短语、不以动词开头」无法机械执行——`@zhushanwen` 给出的中文正例「修复登录超时」本身就是动词短语。同时补一条 Claude Code 的核心洞察来堵住漏洞：**动词后面必须紧跟具体对象**，否则会产出 `修复问题` 这类新的泛化。
- **照搬 Claude Code 的 `two to five words`**。否决理由：中文没有词边界，纯中文标题的 `words` 计数恒为 0（汉字先被 `replace` 掉再数词），这条规则对中文既拦不住过长也拦不住过短。上游凡是要求语言跟随的实现（OpenCode、Codex、`@oipsanthony`、`@tifan`）都用字符口径。
- **改用单一「显示宽度」上限（32 列）替代双分支校验**。否决理由：它确实与 Pi 真实的截断单位一致（footer 与会话选择器都走 `truncateToWidth`），但精度在两个极端都会失真——32 列对英文相当于 6-7 个词，比现有的 5 词宽不少；而且要改 `countTitleLength` 的公开返回结构。双分支 AND 不是坏规则，它本来就是**按脚本分别给预算**（纯中文只看汉字数、纯英文只看词数），真正的问题只是**给模型看的表述**里有两个数。改为「重试只报被超出的那一侧」即可。
- **输出格式改成 `<session_name>` 标签契约或 JSON schema**（`@moguw` / Claude Code / Codex 的做法）。否决理由：本插件走 `modelRegistry.complete()` 的非 simple 路径，`StreamOptions` 上没有 `response_format` 一类旋钮（源码推断，未抓包确认），结构化输出不可用；标签契约则要连带改 `normalizeTitle` 与既有测试，而当前没有「输出格式怪」的实际症状。改为在提示词里**点名**常见污染前缀（Zed 的写法）。
- **长度超限重试从 3 次降到 0 次**。否决理由：给模型一次改正机会的成本很低，而上游「直接截断」的做法会静默改变用户看到的名字；保留 1 次是「不重试」与「4 次请求」之间的折中。
- **让 `TitleRequestOptions` 从 `StreamOptions` 派生（`Pick<…>`）而不是手写字段**。否决理由：`Pick` 会把 `cacheRetention` 保留为可选，丢掉「必须传 `"none"`」这条保证；而 `signal` / `maxTokens` / `cacheRetention` 三个字段都是稳定的公开 API。代价是上游若改名不会报类型错，因此在 `src/index.ts` 的 `modelRegistry.complete()` 调用点依赖类型检查兜底。

## 不可静默更改的不变量

1. **两类失败的重试上限必须分开。** 长度超限是「模型给了答案但不合格」，给 1 次改正机会；回复没有正文是「预算被思考吃光」这类模型侧故障（部分模型的 `thinkingLevelMap.off` 为 null，provider 无法关闭思考），给 3 次机会。共用一个常量会让「降低长度重试成本」顺带砍掉思考型模型的容错网。代价是**最坏请求数从 4 升到 5**（初始 1 + 长度重试 1 + 空回复重试 3），只有在模型交替产出「超长」与「空正文」时才会达到。
2. **重试的 user 消息只放数据，system 提示在重试之间保持不变。** 重试请求是一次全新的单条请求，没有上一轮的记忆，所以被拒原因必须随请求发出；但「怎么改」属于固定规则，放在 system 提示里（`A retry also carries a <previous-title> tag…`），否则模型会在两套指令之间摇摆。
3. **提示词里的硬上限数字必须来自 `MAX_HAN_CHARACTERS` / `MAX_WORDS` 常量，不能手写字面量。** 校验、system 提示、重试提示三处必须同时改；历史上提示词写 `2 to 6 words` 而校验是 `10 汉字 / 5 词`，这个不一致本身就是模型输出不稳定的一部分来源。软目标区间（`3 to 6 words or 8 to 14 Chinese characters`）不参与校验，因此可以写字面量，但必须与硬上限自洽。
4. **`<user-prompt>` 标签是输入契约。** `test/index.test.ts` 断言它的包裹格式；改标签名或去掉包裹会破坏该断言。
5. **祈使动词规则必须与「紧跟具体对象」成对出现。** 只写前者会产出 `修复问题`、`Improve performance`，比原来更糟。
6. **语言跟随的澄清句不能省。** 只写 `use the same language as the user` 时，英文指令仍会把输出拉向英文；`not the language of these instructions` 是关键半句（上游 Claude Code 原句）。

## Consequences

- **`buildRetryTitlePrompt` 的签名从 `(title)` 变为 `(title, prompt)`**，`buildTitlePrompt` 的返回值不再包含任何指令文本，新增导出 `buildTitleSystemPrompt` 与 `TitleRequestOptions`。三者都是对外可见变更，按 0.x 惯例走 minor changeset。
- **system 提示里内嵌 4 条中文 few-shot 正例**，与仓库「运行时提示使用英文」的规范字面有张力。这是刻意例外：指令主体仍是英文，中文只出现在「示例输出」这一侧，否则无法锚定语言跟随（只靠一句 `use the same language` 时模型仍会输出英文）。改动这块示例时必须保留至少一条中文与一条英文。
- **`controller.ts` 的超限警告文案去掉了重试次数**（原文 `stopped after 3 retries`）。因为两类失败各有独立上限，单一数字不再能描述它，而文案里写死数字必然再次失准。
- **标题长度上限从 10 汉字 / 5 词放宽到 20 汉字 / 10 词**，这是明确的信息量取舍。代价已量化：20 个汉字 = 40 显示列，恰好等于 80 列终端里 footer 给会话名的全部预算（`~/programming/ai/pi-extensions (main) • ` 已占 41 列），因此满长度的中文标题在 80 列终端的 footer 里会被截断；会话选择器（`/resume`）不受影响，那里 80 列终端仍有约 67 列可用。
- **提示词里的目标区间是软约束，硬上限才进校验。** 目标「3-6 词或 8-14 汉字」只写在 system 提示里，不参与 `isTitleWithinLimit`；并且显式补一句「已能命名具体对象时，更短的短语优于凑字数」，否则目标区间的下限会把 `打招呼` 这类本来就该短的标题逼成凑字。
- **语言跟随与要点提取的效果没有实验支撑。** 本 ADR 的依据是 11 家上游的一致实践与 Anthropic 的提示词文档，**不存在**针对标题生成的语言跟随 A/B 实验。已做的是拿 12 条真实历史首句在两个模型上做前后对比（24/24 长度合规、0 条语言跟随失败），但这不是受控实验。
- **未纳入本次范围的两项**：请求超时（上游普遍加 20-30s，本插件只在 session 关闭时 abort）与 `normalizeTitle` 的前言清洗（`Here is a title:` 这类句子式前言目前仍会被原样写入会话名）。
- **`docs/research/pi-session-rename.md` 的 §Title Length Policy 是本次改动前的快照**，其「10 Han characters / 5 non-Han words」已被本 ADR 取代，该文件顶部有指向这里的更新说明。

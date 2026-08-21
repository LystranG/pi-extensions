# Pi statusline UI API 调研

> 调研对象：`plugins/statusline/src/index.ts`、`plugins/statusline/package.json`
>
> 调研报告保存于 `docs/research/statusline-ui-api.md`

## 结论摘要

1. 给输入框左侧增加 Claude Code 风格的 `>`，公开且稳定的方案是 `ctx.ui.setEditorComponent(factory)`，factory 返回 `CustomEditor` 子类；在子类 `render(width)` 中调用 `super.render(width)`，给返回行加提示符并按 `visibleWidth`/`truncateToWidth` 处理宽度。`setFooter` 只能替换 footer，不能改变输入框。
2. 自定义 footer 的公开契约是 `ctx.ui.setFooter((tui, theme, footerData) => Component)`。`theme.fg` 可使用当前主题的语义颜色；footerData 提供 git branch 和 extension statuses。每个 `render(width)` 返回的可见宽度必须不超过 width，ANSI 颜色不应计入宽度；Nerd Font glyph 需要终端字体支持，并且实际显示宽度不能仅凭字符数估算。
3. 当前插件使用了正确的公开 API：`ctx.ui.setFooter`、`footerData.onBranchChange`、`getGitBranch`、`getExtensionStatuses`、`theme.fg`、`visibleWidth`、`truncateToWidth` 均符合文档/示例。不过它目前没有实现输入框 prompt；另有版本兼容风险：`package.json` 将 Pi peer/dev 版本锁在 `>=0.84.2`，而 `getEditorComponent` 是较新的可组合 editor API，若未来使用必须确认本机 0.84.2 的公开类型是否已包含它。

## 1. 输入框左侧 prompt 的公开 API

### 推荐实现

```ts
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

class PromptEditor extends CustomEditor {
  override render(width: number): string[] {
    const lines = super.render(width);
    const prefix = this.theme.fg("accent", "> ");
    return lines.map((line) => {
      const available = Math.max(0, width - visibleWidth(prefix));
      return truncateToWidth(prefix + truncateToWidth(line, available), width);
    });
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings));
  });
}
```

实际实现应根据 `CustomEditor.render()` 的多行布局决定 prefix 是否只放在第一行，或让后续行使用等宽空格对齐；不能假设 prompt 只占一行。`render(width)` 必须以收到的 width 为准重新计算，而不是捕获启动时 terminal width。

Pi 官方扩展文档把 `setEditorComponent` 和 `CustomEditor` 作为 custom editor 模式，示例 `modal-editor.ts` 说明应继承 `CustomEditor`（而不是底层 `Editor`）以保留应用级 escape、Ctrl+D、模型切换等 keybindings，并在未处理输入时调用 `super.handleInput(data)`。官方文档与对应示例入口：[extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[modal-editor.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/modal-editor.ts)。

### 组合与生命周期

`setEditorComponent` 是 editor factory 的单一拥有者；多个扩展直接设置时，后设置者会替换前者。较新的公开 API `ctx.ui.getEditorComponent()` 允许捕获已有 factory 后包装它，随后在 shutdown 或停用时恢复旧 factory。该 API 的变更和文档示例见 [d698647](https://github.com/badlogic/pi-mono/commit/d698647b128b71ebe7fa648e173d719dc4a8abf7) 与 [#3935](https://github.com/earendil-works/pi/issues/3935)。

兼容性注意：仓库 manifest 当前声明 `@earendil-works/pi-coding-agent` `>=0.84.2`。报告未能从仓库工作区读取安装的 node_modules，因此不能仅凭本地运行时断言 `0.84.2` 是否已包含 `getEditorComponent`；添加 prompt editor 前应以本机公开 `.d.ts` 为准，并在目标 Pi 版本执行类型检查和 TUI smoke test。若只调用已有的 `setEditorComponent`，当前 manifest 与源码形式是匹配的。

## 2. Footer/statusline 颜色、宽度和图标

### 主题颜色

Footer factory 的第二个参数是当前公开 `Theme`。应优先使用语义颜色，而不是写死 ANSI/24-bit 色：常见 footer 示例使用 `theme.fg("dim", text)`、`theme.fg("accent", text)`、`theme.fg("success", text)`、`theme.fg("warning", text)`、`theme.fg("error", text)` 和 `theme.fg("muted", text)`。具体 RGB 值由用户当前主题决定；扩展不应假定某个主题一定存在某个视觉色值。官方 custom footer 示例：[extensions.md Pattern 6](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)。

`footerData` 的公开数据包括：

- `getGitBranch(): string | null`
- `getExtensionStatuses(): ReadonlyMap<string, string>`
- `onBranchChange(listener): unsubscribe`（用于触发 `tui.requestRender()`）

模型、session 和 token/context 数据仍应从 `ctx.model`、`ctx.sessionManager`、`ctx.getContextUsage()` 等公开上下文取得，不应读取 footer 内部实现。Footer API 的变更说明：[3376a8c](https://github.com/earendil-works/pi/commit/3376a8c72d5d71f8b6fd7c65fd086f68776b27b9)。

### 宽度测量和截断

`@earendil-works/pi-tui` 的 `visibleWidth` 忽略 ANSI escape sequence，`truncateToWidth` 保留样式并在需要时截断。TUI 的 `Component.render(width)` 契约要求每条返回行的可见宽度不超过 width；超宽行可能直接触发 TUI error。官方 TUI 文档：[tui README](https://github.com/badlogic/pi-mono/blob/main/packages/tui/README.md)，官方扩展文档的 custom component 示例同样要求用这两个函数。

当前插件的宽度处理是正确方向：`layoutStatusline()` 用 `visibleWidth(value) <= width` 判断，最终使用 `truncateToWidth(fields.directory, width)`；`layoutStatuslineLines()` 对第二、第三行也调用 `truncateToWidth`。这覆盖了 ANSI 颜色、emoji 和宽字符通常带来的字符数/显示列数差异。

仍需注意：`layoutStatuslineLines()` 在 `width > 0` 时返回 footer 行，`truncateToWidth` 是必要保护；任何新加的 prefix、separator 或 Nerd Font 字符必须在最终组合后再次测量，而不是分别测量后用 JS `.length` 相减。

### Nerd Font 图标兼容

``、``、`󰒍` 等私用区 glyph 不是 Pi API 的图标资源，而是终端字体提供的字形。它们只有在用户终端安装并选用包含对应 codepoint 的 Nerd Font/Powerline 字体时才会显示；否则可能显示空框、替代字形或不同列宽。Nerd Fonts 官方项目说明其字体是对常见字体打补丁并提供这些 glyph：[ryanoasis/nerd-fonts](https://github.com/ryanoasis/nerd-fonts)。

兼容建议：

- 提供 ASCII/Unicode fallback，或允许用户关闭 Nerd Font 图标
- 不把 glyph 的 UTF-16/JS 字符长度当作终端列宽
- 将图标与文字一起交给 `visibleWidth`/`truncateToWidth`
- 特别测试窄终端、emoji、私用区字符和 ANSI 嵌套样式
- 不将 `` 等字面 glyph 当作“公开 Pi API”；它们属于插件自身显示选择

## 3. 对当前插件的 API 审核

### 正确项

- `plugins/statusline/src/index.ts:218`：在 `session_start` 的 TUI 模式中调用 `ctx.ui.setFooter(...)`，是官方替换 footer 的公开入口
- `:222-224`：保存 `footerData.onBranchChange` 的 unsubscribe，并在 `dispose()` 清理，符合 footer lifecycle
- `:230-263`：通过 `footerData.getGitBranch()`、`getExtensionStatuses()`、`ctx.model`、`ctx.sessionManager`、`ctx.getContextUsage()` 读取公开数据，没有引用 Pi 内部源码或 dist
- `:237-240`、`:270-287`：使用 `theme.fg` 语义颜色
- `:2`、`:144`、`:203-204`：从公开 `@earendil-works/pi-tui` API 导入 `visibleWidth` 和 `truncateToWidth`，并在最终行布局处使用
- `plugins/statusline/package.json`：Pi coding-agent 和 pi-tui 同时列在 peerDependencies/devDependencies，符合仓库约束

### Findings（按严重性）

1. **中：当前插件没有输入框左侧 `>` prompt。** `plugins/statusline/src/index.ts:218-292` 只注册 custom footer，没有 `ctx.ui.setEditorComponent`；因此需求 1 不能由当前插件现状满足。实现应新增 `CustomEditor` 派生 editor，或采用同等公开 editor factory 包装方式，而不是改 footer 字符串。
2. **中：Nerd Font 字符没有 fallback/能力开关。** `:282`、`:284`、`:286`、`:289` 直接输出 ``、``、`󰒍` 等私用区 glyph。缺少 Nerd Font 时视觉退化；这不是 API 错误，但属于跨终端兼容风险。宽度函数已正确处理显示列宽，不能因此推断 glyph 在所有字体上都可见。
3. **低：版本声明与未来 editor composition API 的边界未验证。** `package.json` 声明 `>=0.84.2`，但当前代码未使用 `getEditorComponent`。若后续为 prompt 实现组合，应核对本机 0.84.2 的公开类型；不能只依据 main 分支文档，因为 Pi API 会演进。
4. **低：自定义 footer 的刷新监听不覆盖所有状态。** 当前通过事件回调主动刷新 model/thinking/session/message/tool 等状态，branch 变化通过 `onBranchChange` 刷新；若其他扩展 status 变化不会触发插件自己的 `requestRender`，则 `footerData.getExtensionStatuses()` 的变化是否及时显示取决于 Pi 是否同时请求 footer render。建议以本机 API/行为测试确认，或让发布 status 的扩展负责触发更新。

## Sources

- Kept: [Pi extension docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) — `setFooter`、`setEditorComponent`、`CustomEditor`、Theme 和宽度示例的第一方文档
- Kept: [Pi TUI README](https://github.com/badlogic/pi-mono/blob/main/packages/tui/README.md) — Component.render(width)、`visibleWidth`、`truncateToWidth` 契约
- Kept: [FooterDataProvider change](https://github.com/earendil-works/pi/commit/3376a8c72d5d71f8b6fd7c65fd086f68776b27b9) — `footerData` 的公开字段和 footer 示例变更
- Kept: [Composable editor factory](https://github.com/badlogic/pi-mono/commit/d698647b128b71ebe7fa648e173d719dc4a8abf7) — `getEditorComponent` 及 editor 组合语义
- Kept: [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) — 私用区图标的字体兼容背景
- Dropped: 第三方 footer 包、博客和 issue 讨论 — 仅用于交叉检查实践，不作为 Pi API 契约的主要依据

## Gaps and verification

- 本次运行环境没有可读的项目 `node_modules/@earendil-works/pi-coding-agent` 路径，无法直接读取本机安装包的 `.d.ts`；因此版本 0.84.2 对 `getEditorComponent` 的精确存在性列为待验证项
- 未修改插件源码，未运行测试或 Pi TUI smoke test
- 在实现 prompt 后应至少验证：默认输入编辑/提交/历史/补全不回归；宽度 1、窄终端和多行输入；无 Nerd Font 终端；另一个 editor extension 同时安装时的组合/恢复；`pi --no-ui` 或 RPC 模式不崩溃

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "research.md contains concrete API findings and severity-tagged review findings with paths plugins/statusline/src/index.ts and plugins/statusline/package.json"
    }
  ],
  "changedFiles": [
    "/Users/lystran/programming/ai/pi-extensions/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read .pi/skills/research/SKILL.md completely",
    "Read plugins/statusline/src/index.ts and plugins/statusline/package.json",
    "Performed focused searches against official Pi extension/TUI documentation and primary repository changes"
  ],
  "residualRisks": [
    "Local Pi 0.84.2 declaration files were not available at the expected workspace node_modules path",
    "No runtime TUI smoke test was run because this task was research-only",
    "Nerd Font private-use glyphs have no fallback in the current plugin"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the requested Chinese research report and acceptance evidence; plugin source was not modified",
  "reviewFindings": [
    "medium: plugins/statusline/src/index.ts:218-292 - current plugin replaces only the footer and does not add an input prompt",
    "medium: plugins/statusline/src/index.ts:282,284,286,289 - Nerd Font private-use glyphs lack a fallback or capability switch",
    "low: plugins/statusline/package.json - future use of getEditorComponent requires checking the installed 0.84.2 public declarations",
    "low: plugins/statusline/src/index.ts:218-292 - extension-status refresh behavior should be confirmed with a runtime test"
  ],
  "manualNotes": "The runtime-authoritative output path was research.md; docs/research/statusline-ui-api.md was not written."
}
```

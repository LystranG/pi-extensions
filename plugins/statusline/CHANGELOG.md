# @lystran/pi-statusline

## 0.1.3

### Patch Changes

- 1357d7f: Keep provider streaming parser errors in a dedicated widget above the editor so they do not corrupt the framed statusline.
- a260344: Revert the 0.1.3 error widget feature: provider streaming parser errors are no longer intercepted or shown above the editor, restoring the previous display behavior for assistant turn errors

## 0.1.2

### Patch Changes

- e481939: Add a shortcut to copy logical input text without terminal line-padding spaces

## 0.1.1

### Patch Changes

- aa67497: Show non-zero cache reads and writes below 1K as raw token counts instead of rounding them to `R0K` or `W0K`.

## 0.1.0

### Minor Changes

- ec4ecc4: 新增支持 session 名称的简约图标化 statusline，以及映射 Pi 生命周期的 Serena hooks 插件。

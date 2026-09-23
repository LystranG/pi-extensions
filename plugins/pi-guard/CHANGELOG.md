# @lystran/pi-guard

## 0.4.0

### Minor Changes

- 5b26b08: Send a terminal notification right before a confirmation dialog appears, using `OSC 99` on kitty and `OSC 777` on the other terminals that render it, with tmux and GNU screen excluded, and the terminal bell now written only on an interactive terminal

## 0.3.0

### Minor Changes

- 3b89511: Send a system notification right before a confirmation dialog appears, with macOS and Linux fallback chains, throttling, an optional command summary, and a terminal bell when no notification tool can deliver

## 0.2.0

### Minor Changes

- 3103dae: Generate a user configuration on first load and ask for confirmation by default for dcg-classified dangerous commands

## 0.1.0

### Minor Changes

- 663d926: 新增基于 destructive_command_guard 的 Pi 危险命令权限插件，支持具体命令规则、直接拒绝、交互确认和界面反馈

# Changelog

## 0.2.1

### Patch Changes

- c887487: Move the host-provided `@earendil-works/pi-ai` package out of `dependencies` and declare it as a peer dependency with a `"*"` range
  
  Pi supplies `pi-ai` to extensions through its own module mapping, and since 0.99.0 it warns when a loaded package lists a host-provided module in `dependencies`: an installed copy can bypass that mapping and create duplicate runtime modules. Only the manifest changes, so both extensions behave exactly as before; the upgrade removes the startup warning and stops pulling a stale `pi-ai` copy into the managed install. `pi-ai` stays in `devDependencies` for type checking, and `scripts/validate-packages.ts` now checks Pi's whole host package list instead of `pi-coding-agent` alone.

## 0.2.0

### Minor Changes

- de691e4: 新增仅供 AI 调用的 Maven 工具，优先执行项目 `./mvnw`，否则执行 PATH 中的 `mvn`，并提供 compact 输出、失败诊断和完整日志保留

## 0.1.0

- 初始版本

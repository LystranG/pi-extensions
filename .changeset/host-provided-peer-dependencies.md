---
"@lystran/pi-mvn-compact": patch
"@lystran/pi-session-rename": patch
---

Move the host-provided `@earendil-works/pi-ai` package out of `dependencies` and declare it as a peer dependency with a `"*"` range

Pi supplies `pi-ai` to extensions through its own module mapping, and since 0.99.0 it warns when a loaded package lists a host-provided module in `dependencies`: an installed copy can bypass that mapping and create duplicate runtime modules. Only the manifest changes, so both extensions behave exactly as before; the upgrade removes the startup warning and stops pulling a stale `pi-ai` copy into the managed install. `pi-ai` stays in `devDependencies` for type checking, and `scripts/validate-packages.ts` now checks Pi's whole host package list instead of `pi-coding-agent` alone.

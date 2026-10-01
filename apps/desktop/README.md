# @navin/desktop

Thin **Tauri 2** desktop shell for Navin. It composes two lazily loaded surface
bundles (Mail and permission-gated Control) over a small set of narrowly
allowlisted native bridges.

> The shell owns **composition and native bridges only**. It contains no mail
> parsing, setup/action planning, AI execution or engine logic — that all lives in
> `navind` and the surface bundles.

## Layout

```text
apps/desktop/
  index.html                 shell entry + web-fallback CSP
  ipc/allowlist.json         canonical IPC allowlist (shared with Rust)
  src/
    main.ts                  boots the shell
    shell/
      app-shell.ts           runtime detection, nav, lazy mount
      config.ts              fail-closed desktop config
      permissions.ts         entitlement → surface gating
      module-registry.ts     lazy Mail/Control contributions
      platform.ts            Tauri vs web detection
      ipc/                   allowlist + injectable native transport
      navind/                endpoint policy, SSE parse/resume, client
      adapters/              deep-link, dialog, notification, keychain, updater
      native/tauri-bindings.ts  the only file importing @tauri-apps/*
    modules/{mail,control}   thin composition boundaries (no domain logic)
  src-tauri/
    Cargo.toml               Tauri app crate + core workspace
    tauri.conf.json          window, strict CSP, NSIS/MSI bundle
    capabilities/default.json  narrow plugin permission allowlist
    src/                     plugin wiring + allowlisted commands
    crates/navin-desktop-core  pure, unit-tested policy core
  tests/                     Vitest suites
```

## Security boundaries

- **Narrow IPC allowlist.** `ipc/allowlist.json` is embedded by Rust
  (`navin-desktop-core::ipc`) and imported by the renderer. Unknown commands are
  denied on both sides, and a malformed allowlist denies everything.
- **Permission-gated Control.** The shell only offers a module the session is
  entitled to; `loadSurfaceModule` throws before any bundle is fetched. Hiding
  Control is UX only — the backend stays authoritative.
- **Endpoint policy.** Only `https://` remote navind endpoints are accepted;
  plaintext `http://` is allowed on loopback only. There is no downgrade path.
- **No plaintext secret fallback.** Remote refresh material is stored only in the
  OS keychain. When no keychain exists (web fallback), secret storage is
  explicitly `unavailable` — never localStorage, files or cookies.
- **Fail-closed updater.** The updater ships disabled with no endpoints, key or
  host allowlist. Enabling it requires a signed, HTTPS-only, allow-listed config
  (`resolveUpdatePolicy`); anything ambiguous is rejected.
- **Strict CSP.** `default-src 'self'` with IPC-only `connect-src` plus TLS
  origins and loopback dev endpoints; no `unsafe-eval`, no inline scripts.

## Scripts

```bash
pnpm dev            # vite dev server (web fallback)
pnpm build          # vite build → dist/ (frontendDist)
pnpm typecheck      # tsc for src and tests
pnpm test           # vitest (shell, IPC, navind, adapters)
pnpm test:rust      # cargo test -p navin-desktop-core
pnpm tauri:dev      # Tauri dev (requires a Rust toolchain + WebView2)
pnpm tauri:build    # Windows NSIS/MSI package (primary proof target)
```

`cargo test` runs the pure core crate without building the Tauri app; run it from
`src-tauri/` for the full workspace.

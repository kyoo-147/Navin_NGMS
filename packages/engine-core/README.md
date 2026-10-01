# @navin/engine-core

Replaceable mail-engine boundary and the first concrete engine adapter (Stalwart admin) for the
Navin platform (Phase 1, worker W14).

`navind` and Control actions talk to a mail engine only through the `MailEngineAdapter` interface.
Engine-specific payloads (JMAP admin methods, wire objects) never leak past `src/stalwart/`.

## Scope

- `MailEngineAdapter` — the replaceable boundary: `health`, `version`, `discover`, `planDomain`,
  `planMailbox`, `planAlias`, `apply`, `verify`, `rollback`.
- `StalwartEngineAdapter` — admin adapter implementing the boundary over the Stalwart admin
  (JMAP-style) HTTP API.
- Secure transport with auth (`bearer` | `basic`), idempotency keys, timeouts, cancellation,
  bounded responses, no redirect following, and bounded retries.
- Normalized errors that map onto the frozen `NavinError` envelope from `@navin/contracts`.
- A loopback-only `StalwartFixtureServer` (`@navin/engine-core/testing`) for protocol tests.

## Boundary and dependency policy

This package declares **no dependencies**, so adding it does not change the workspace
`pnpm-lock.yaml`. It consumes the frozen `@navin/contracts` types for local type-checks and
contract-conformance tests through a workspace path alias (`tsconfig.test.json` and
`vitest.config.ts`). When the integrator wires build order, add `"@navin/contracts": "workspace:*"`
to `dependencies` and regenerate the lockfile; `src` itself only needs the contract for type-level
conformance, asserted in `tests/contract-conformance.test.ts`.

No Navin package may import a Stalwart-specific type outside `src/stalwart/`.

## Lifecycle

```text
discover → plan → apply → verify → rollback
```

- `plan*` reads observed engine state and produces a typed `EnginePlan` with an exact diff, a
  deterministic `idempotencyKey` and a risk tier (`0` no-op, `1` reversible create/update).
- `apply` re-reads state, skips steps already satisfied (idempotent re-apply), and sends a stable
  `Idempotency-Key` per step for engine-side deduplication.
- `verify` re-reads state and reports per-step expected/actual checks.
- `rollback` is stateless: it reverses using the prior state captured in the plan (destroy created
  resources, restore updated fields).

Secrets such as mailbox passwords are never part of a plan or diff. They are passed at apply time
via `EngineApplyOptions.secrets` keyed by step id, and are redacted from errors and details.

## Security notes

- Insecure `http://` is refused unless the host is a literal loopback IP (`127.0.0.1` or `[::1]`);
  hostname aliases and alternate numeric spellings are rejected.
- Endpoint credentials, query strings, fragments, traversal, ambiguous hosts, and caller attempts to
  override reserved transport headers are rejected.
- Redirects are not followed, so credentials are never forwarded to another origin.
- Bearer/basic credentials live in an `AuthProvider`; only redacted forms are ever rendered.
- Responses are size-capped; requests honor both a timeout and an external `AbortSignal`.
- Tests and the fixture server bind `127.0.0.1` only and never contact a production host.

## Stalwart admin protocol profile

`src/stalwart/profile.ts` centralizes endpoint paths and admin method names
(`x:Domain/query|get|set`, `x:Account/query|get|set`, `x:Alias/query|get|set`). The defaults are
reconciled against the local fixture in tests; live reconciliation against a disposable engine is a
separate acceptance gate (Phase 1 G3) and is intentionally out of scope here.

## Scripts

```bash
pnpm --filter @navin/engine-core run typecheck
pnpm --filter @navin/engine-core run test
pnpm --filter @navin/engine-core run build
```

# @navin/auth

Production auth and session package for the Navin platform (Phase 1, worker W11).
It is intentionally dependency-free (Node built-ins only) so it adds no external
runtime surface and requires no workspace lockfile change.

## What it provides

- **Separate Mail vs Control issuers and audiences.** `createMailIssuer` /
  `createControlIssuer` own distinct signing keys, issuer names and audiences
  (`navin-mail`, `navin-control`). A Mail token cannot validate at the Control
  verifier and vice versa. `surface` is bound per relying party (`mail` vs
  `control`/`cli`).
- **`__Host-` cookies.** Host-only `Secure`+`HttpOnly` cookies with distinct Mail
  (`SameSite=Lax`) and Control (`SameSite=Strict`) names; no `Domain` attribute
  and no privileged parent-domain cookie.
- **Local administrator password hashing.** scrypt (OWASP-recommended parameters,
  64 MiB maxmem) with per-password salt, constant-time verification, policy
  validation and rehash detection.
- **Login, session rotation and revocation.** Issue, validate, rotate and revoke
  sessions; rotation after authentication and privilege change; revoke-all on
  password change; device/session listing. Sessions persist only a SHA-256 hash
  of the issued token plus a server-side CSRF secret.
- **Scoped RBAC.** Least-privilege role catalog (no undifferentiated `admin`),
  wildcard scope matching, and deny-by-default authorization that enforces
  relying-party/assurance requirements. `ops.*` roles carry no `mail:*` scope.
- **Tier 3 recent-auth.** Risk tiers 0–3; Tier 3 requires typed confirmation plus
  recent step-up authentication and is never bypassed by `--yes`.
- **CSRF/origin defenses.** Session-bound synchronizer token plus a fail-closed
  exact-origin allowlist for state-changing requests.
- **Injectable clock/random/store.** `Clock`, `RandomSource` and `AuthStore`
  interfaces with deterministic test doubles (`FixedClock`,
  `DeterministicRandom`, `InMemoryAuthStore`) and a real `SqliteAuthStore`.
- **No secret leakage.** Fixed, generic error messages; a `redactUnknown`
  helper; audit events carry only non-secret identifiers.

## Layout

```text
src/
  types.ts        domain types mirroring @navin/contracts auth/session schemas
  errors.ts       AuthError + stable codes
  redaction.ts    secret redaction for logs
  encoding.ts     base64url, sha256, constant-time compare
  clock.ts        Clock / SystemClock / FixedClock
  random.ts       RandomSource / SystemRandom / DeterministicRandom
  password.ts     scrypt hashing + policy
  tokens.ts       HMAC compact token signing/verification
  issuers.ts      TokenIssuer + Mail/Control factories
  cookies.ts      __Host- cookie policies and serialization
  rbac.ts         role catalog + authorization
  risk.ts         risk tiers + recent-auth
  csrf.ts         CSRF token + origin checks
  service.ts      AuthService composition
  store/          AuthStore, InMemoryAuthStore, SqliteAuthStore
```

## Usage

```ts
import {
  AuthService,
  InMemoryAuthStore,
  SystemClock,
  SystemRandom,
  createMailIssuer,
  createControlIssuer,
} from '@navin/auth'

const clock = new SystemClock()
const service = new AuthService({
  store: new InMemoryAuthStore(),
  clock,
  random: new SystemRandom(),
  mailIssuer: createMailIssuer({ key: mailKey, clock }),
  controlIssuer: createControlIssuer({ key: controlKey, clock }),
  allowedOriginsByRelyingParty: { 'navin-control': ['https://control.example.com'] },
})

service.createUser({ email: 'admin@example.com', password: '…', roles: ['ops.super_admin'] })
const session = service.login({
  email: 'admin@example.com',
  password: '…',
  relyingParty: 'navin-control',
  surface: 'control',
})
service.validate({ token: session.token, relyingParty: 'navin-control' })
```

## Security hardening

- **Anti-enumeration login.** Unknown and disabled accounts still perform a
  password verification against a fixed dummy verifier, so they are not
  observably faster than a wrong password and return the same generic error.
- **Fail-closed validation.** `validate()` re-checks the current user (rejecting
  disabled/removed accounts) and requires the persisted session to agree with
  the signed payload on relying party, surface, user id and account id.
- **Atomic rotation and password change.** `AuthStore.rotateSession` and
  `AuthStore.changePasswordAndRevokeSessions` run inside a single transaction
  (SQLite `BEGIN IMMEDIATE` with rollback; snapshot/restore in memory), so a
  failure can never leave two live sessions after a rotation nor a changed
  password alongside still-active old sessions.
- **Bounded input.** scrypt `N`/`r`/`p`, salt/hash lengths, password length and
  encoded verifier size are range-checked before any computation; malformed or
  over-limit verifiers return `false` instead of throwing. Tokens are length
  bounded and structurally validated, and issued TTLs must be finite, positive
  and within `MAX_TOKEN_TTL_MS`.

`preCommit(point)` on the stores is a protected test seam for fault injection;
it is a no-op in production.

## Requirements

- Node.js 22+ with the built-in `node:sqlite` module available (`SqliteAuthStore`).
  On Node 22.x this may require `--experimental-sqlite`; it is stable from Node 24.
- `InMemoryAuthStore` has no such requirement.

## Testing & typecheck

```bash
pnpm --filter @navin/auth test
pnpm --filter @navin/auth typecheck
pnpm --filter @navin/auth build
```

`tests/sqlite-restart.test.ts` runs real SQLite restart tests against a temp
database file; `tests/contracts-conformance.test.ts` validates issued payloads and
cookie policies against the frozen `@navin/contracts` schemas.

# @navin/navind

The Navin platform daemon kernel. It owns the process lifecycle, configuration,
persistence and observability spine that the Mail, Control and CLI surfaces are
built on. It contains **no business domain logic** — no mail, setup, action,
auth or extension behaviour — only the infrastructure every one of those
modules needs.

## What the kernel provides

- **Fastify lifecycle** — one HTTP server with ordered request hooks, graceful
  `listen`/`close`, and structured error envelopes.
- **Validated, redacted configuration** — TypeBox schema over environment
  variables, defaults, cross-field rules and secret masking.
- **SQLite WAL persistence** — a `node:sqlite` adapter in WAL mode with a
  transactional, idempotent, drift-checking migration runner.
- **Health and readiness** — `/health` liveness and `/ready` readiness driven
  by registered, criticality-aware checks.
- **Graceful shutdown** — an idempotent, ordered, timeout-bounded coordinator
  wired to `SIGINT`/`SIGTERM` and to an optional IPC control channel.
- **Correlation IDs** — per-request ids propagated through `AsyncLocalStorage`,
  echoed on `x-correlation-id` and attached to every log line.
- **Structured logging** — JSON records with level filtering, child bindings
  and recursive secret redaction.
- **DI ports** — `Clock`, `IdGenerator`, `Logger`, `Database`, `HealthCheck`
  and `SignalSource` interfaces with production adapters.

## Layout

```text
src/
  ports/        Dependency-injection interfaces
  adapters/     Production implementations (clock, ids, logger, sqlite)
  config/       TypeBox schema, loading and redaction
  correlation/  AsyncLocalStorage correlation context
  logging/      Log-value redaction
  db/           Migrations, migrator, kernel metadata store
  health/       Health registry and readiness checks
  http/         Fastify server, hooks, routes, error envelopes
  kernel/       Container, lifecycle, shutdown coordinator
  main.ts       Entry point (signals + optional IPC control)
tests/          Unit, SQLite restart/concurrency and real-process tests
```

## Endpoints

| Method | Path      | Purpose                                            |
| ------ | --------- | -------------------------------------------------- |
| GET    | `/health` | Liveness; never touches dependencies.              |
| GET    | `/ready`  | Readiness; 503 when a critical check is unhealthy. |
| GET    | `/meta`   | Build/runtime metadata (no secrets).               |

Every response echoes the request correlation id via the `x-correlation-id`
header and in the body.

### Mail BFF

Browser Mail surfaces call `navind`, never the mail engine. The Mail BFF mounts
the normalized JMAP gateway under `/api/v1/mail/*` behind a separate
`navin-mail` relying party and the `mail` surface. Upstream JMAP session URLs and
Authorization values stay server-side; callers only ever present a Navin session
(cookie or bearer token) and normalized requests.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/v1/mail/auth/login` | Mail login; issues the host-only mail session. |
| GET | `/api/v1/mail/auth/session` | Current mail session identity. |
| POST | `/api/v1/mail/auth/logout` | Revoke the mail session. |
| GET | `/api/v1/mail/session` | Normalized upstream session: accounts and capabilities. |
| GET | `/api/v1/mail/mailboxes?accountId=` | Normalized mailbox list. |
| GET | `/api/v1/mail/messages/:messageId?accountId=` | Normalized message. |
| GET | `/api/v1/mail/threads/:threadId?accountId=` | Normalized thread. |
| POST | `/api/v1/mail/query` | Normalized query (returns message/thread ids). |
| POST | `/api/v1/mail/mutations` | Idempotent mutation. |
| POST | `/api/v1/mail/submissions` | Idempotent submission. |
| GET | `/api/v1/mail/events` | SSE mail events (in-process ring; `Last-Event-ID` resumes within one process). |

When no upstream mail binding is configured, **every** Mail endpoint fails
closed with `503 SERVICE_UNAVAILABLE`; it never degrades to an unauthenticated
or fake backend.

Submissions are validated server-side against the configured sender binding:
if no sender identity is configured, or `senderIdentityId`/`from.address` do
not match the configured identity/address (address compared case-insensitively;
the display name carries no authority), the request is rejected with
`403 FORBIDDEN` before any upstream call rather than being silently rewritten.

## Configuration

Configuration is read from the environment and validated on boot. Invalid input
fails startup with a structured `ConfigValidationError`.

| Variable                   | Default            | Notes                                          |
| -------------------------- | ------------------ | ---------------------------------------------- |
| `NAVIN_ENVIRONMENT`        | `development`      | `development` \| `test` \| `production`.       |
| `NAVIN_HOST`               | `127.0.0.1`        | Bind address.                                  |
| `NAVIN_PORT`               | `8080`             | Bind port (`0` picks a free port).             |
| `NAVIN_LOG_LEVEL`          | `info`             | `trace`…`fatal`.                               |
| `NAVIN_DATA_DIR`           | `./data`           | Default parent directory for the database.     |
| `NAVIN_DATABASE_PATH`      | `<dataDir>/navin.db` | SQLite file path.                            |
| `NAVIN_SHUTDOWN_TIMEOUT_MS`| `10000`            | Per-task shutdown ceiling.                     |
| `NAVIN_TRUST_PROXY`        | `false`            | Trust `X-Forwarded-*` headers.                 |
| `NAVIN_BODY_LIMIT_BYTES`   | `1048576`          | Maximum request body size.                     |
| `NAVIN_SESSION_SECRET`     | dev placeholder    | Required (and non-default) in production.      |
| `NAVIN_ENCRYPTION_KEY`     | dev placeholder    | Required (and non-default) in production.      |
| `NAVIN_MAIL_JMAP_SESSION_URL` | unset           | Upstream JMAP session URL.                     |
| `NAVIN_MAIL_JMAP_AUTHORIZATION` | unset         | Upstream Authorization header value (secret).  |
| `NAVIN_MAIL_ACCOUNT_EMAIL` | unset              | Mailbox address mail sessions must match.      |
| `NAVIN_MAIL_SENDER_IDENTITY_ID` | unset         | Authorized sender identity (`usr_`/`als_`); enables compose/send. |

The three `NAVIN_MAIL_JMAP_*`/`NAVIN_MAIL_ACCOUNT_EMAIL` values are
all-or-nothing: providing some but not all fails config validation. Leaving
them all unset disables the Mail BFF. `NAVIN_MAIL_SENDER_IDENTITY_ID` is
optional and requires the complete binding; without it Mail is read-only and
compose/send is disabled.

The mail event stream is a bounded in-process ring. `Last-Event-ID` resumes a
reconnect within the same process only; after a daemon restart a client must
reconcile from authoritative state — the stream is not durable or
restart-resumable.

For local development only, `NAVIN_MAIL_BOOTSTRAP_EMAIL` and
`NAVIN_MAIL_BOOTSTRAP_PASSWORD` seed a `mail.user` account on boot. This
bootstrap is ignored in `production`.

## Scripts

```bash
pnpm --filter @navin/navind dev        # run from TypeScript sources
pnpm --filter @navin/navind build      # compile to dist/
pnpm --filter @navin/navind typecheck  # tsc --noEmit over src + tests
pnpm --filter @navin/navind test       # vitest (unit + process + sqlite)
pnpm --filter @navin/navind start      # run the built daemon
```

## Process control

`SIGINT`/`SIGTERM` trigger graceful shutdown. When the process is started with
an IPC channel (for example via `child_process.fork`), the parent may send the
`navind:shutdown` message to request the same graceful shutdown cross-platform.

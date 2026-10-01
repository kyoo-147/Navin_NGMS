# @navin/mail-gateway

Normalized **server-side JMAP gateway (BFF)** for Navin Mail.

Browser surfaces call `navind`, not the mail engine. This package is the boundary that
turns the normalized Navin mail contracts (`@navin/contracts`) into RFC 8620 (JMAP Core) and
RFC 8621 (JMAP Mail) method calls, and turns upstream objects back into normalized,
contract-safe shapes.

```text
Mail UI ── normalized requests ──▶ MailGateway (this package) ── JMAP ──▶ Stalwart / engine
                                     │
                                     └─ credential provider (server-side only)
```

## Why a gateway

- Browser credentials are **never** forwarded to the mail engine. Callers only ever pass a
  Navin session id; the upstream session URL and Authorization header are resolved
  server-side by a `CredentialProvider` and used exclusively inside the transport.
- Upstream objects and identifiers never leak into the client contracts. Every id is
  re-encoded (see below) and every payload is normalized.
- Card/engine-specific behaviour (state mismatch, capability gaps, error taxonomies) is
  translated into stable Navin error codes.

## Layout

```text
src/
  gateway.ts              MailGateway BFF entry point
  errors.ts               GatewayError + JMAP/HTTP → NavinError mapping + redaction
  credentials/provider.ts credential isolation boundary
  idempotency/store.ts    idempotency keys, replay, conflict detection
  jmap/
    types.ts              hand-authored RFC 8620/8621 subset
    transport.ts          fetch transport with timeout + abort
    client.ts             session bootstrap, capability negotiation, batching
    capabilities.ts       capability parsing, fail-closed guards, engine descriptor
  mapping/
    id.ts                 reversible upstream ⇄ Navin id codec
    session.ts account.ts mailbox.ts email.ts thread.ts
    query.ts mutation.ts submission.ts changes.ts
tests/
  fixtures/jmap-fixture.ts  hermetic in-process JMAP server
  fixtures/harness.ts       gateway + credential provider wired to the fixture
```

## Normalized id codec

JMAP identifiers are opaque and do not satisfy the Navin contract id patterns
(`acc_`, `mbx_`, `thd_`, `msg_`, ...). The codec base64url-encodes the upstream id under a
Navin prefix, so the mapping is deterministic, stateless and reversible:

```ts
encodeId('msg', 'e2') // 'msg_ZTI'
upstreamId('msg_ZTI') // 'e2'
```

Mailbox (`mbx_`) and folder (`fld_`) references intentionally decode to the same upstream
mailbox id, so a mailbox returned by `listMailboxes` can be used directly as a mutation
`destinationFolderId`.

## Mappings

| Normalized contract | Gateway method | JMAP |
| --- | --- | --- |
| session / accounts | `getSession`, `getAccount` | session document, account capabilities |
| mailboxes | `listMailboxes`, `getMailbox` | `Mailbox/get` |
| query | `queryMail` | `Email/query` + `Email/get` |
| email | `getEmail` | `Email/get` |
| thread | `getThread` | `Thread/get` |
| changes | `getEmailChanges` | `Email/changes` |
| mutation | `mutate`, `undoMutation` | `Email/set` (patch + destroy) |
| submission | `submit`, `cancelSubmission` | `Email/set` (draft) + `EmailSubmission/set` |

- **Query** filters map to JMAP `FilterOperator AND` conditions; sort fields map
  (`date → receivedAt`) and are validated against the account's advertised sort options.
- **Mutation** expresses mailbox membership as `mailboxIds/<id>` add/remove patches and flags
  as `keywords/<flag>`. A successful patch returns an `undoToken` whose inverse patch can be
  replayed through `undoMutation`.
- **Submission** persists a draft, then submits it. Scheduled send and undo hold require the
  engine to advertise `urn:example:params:scheduled-send`; otherwise the gateway fails closed
  with `ACTION_BLOCKED` rather than silently sending. The sender identity is verified server
  side against the requested `From` address.

## State, errors and capabilities

- The Email state returned by `Email/get` is supplied as `ifInState` on mutations; an
  upstream `stateMismatch` surfaces as `CONFLICT`.
- JMAP method errors (`notFound`, `stateMismatch`, `serverUnavailable`, ...) and request-level
  HTTP statuses are mapped to `NavinError` codes. Error `details` are always redacted so
  credentials cannot leak through an error envelope.
- Missing capabilities (`urn:ietf:params:jmap:mail`, `...:submission`) fail closed with
  `ACTION_BLOCKED`. Advertised support is projected into the cross-worker
  `EngineAdapterDescriptor`.

## Abort, timeouts and idempotency

- Every transport request is bounded by a timeout and accepts an external `AbortSignal`.
  Timeouts and caller aborts are reported distinctly (`details.reason`).
- `MailGateway` requires an explicitly injected idempotency store and fails closed without one.
  Production deployments should use the exported `SqliteIdempotencyStore` (WAL, atomic
  reservations, schema checksum); `InMemoryIdempotencyStore` is test-only and intentionally not
  selected by default.
- JMAP session URLs are strictly resolved against one validated origin. Remote endpoints must
  use HTTPS; HTTP is limited to literal loopback, with credentials, query/hash, private literal
  targets and redirects rejected.
- `mutate` and `submit` reserve their idempotency key before any upstream mutation. Replays return
  the original response; timeout/abort/network ambiguity is durably marked `needs_attention` and
  never cached as success. Reusing a key with a different payload fails closed with
  `IDEMPOTENCY_CONFLICT`.
- Incoming and outgoing HTML is sanitized to a no-script fragment with remote resources blocked;
  consumers must still render it in a sandboxed document with restrictive CSP.

## Testing

Tests run against a hermetic, in-process JMAP fixture server (`tests/fixtures/jmap-fixture.ts`)
that speaks the real HTTP boundary and reproduces protocol-accurate errors, so credential,
capability, state, timeout, abort and idempotency paths are exercised end to end.

```bash
pnpm --filter @navin/mail-gateway test
pnpm --filter @navin/mail-gateway typecheck
```

## References

Protocol behaviour follows the IETF JMAP RFCs (8620 Core, 8621 Mail) and the JMAP JS
reference registered in `docs/references/jmap-js.json`. No reference source was copied.

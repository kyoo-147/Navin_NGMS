# @navin/protocol-compat

Bounded IMAP4rev1 and SMTP compatibility clients for the Navin platform (plan
worker **W16**). These clients sit behind the engine-adapter boundary so that
`@navin/engine-imap-smtp` can speak real protocols to any RFC-compliant server
without leaking engine-specific payloads through public contracts.

## What it provides

- **Transport** (`./transport`): `BoundedConnection`, a TCP/TLS connection with
  an incremental CRLF/literal byte buffer and hard caps on line length, literal
  size, response size, SMTP reply lines, outgoing DATA size and operation time.
  Every read/write takes cancellation (`AbortSignal`) and timeout controls. A
  timeout or abort is terminal, because IMAP/SMTP frames cannot be
  resynchronized mid-flight.
- **Shared primitives** (`./common`): normalized `ProtocolError` with a
  `NavinError`-compatible `toNormalizedError()` envelope, `ProtocolLimits`
  policy, deadline/cancel helpers, SASL encoders (PLAIN, LOGIN, XOAUTH2) and
  injection-safe address helpers.
- **IMAP** (`./imap`): incremental response parser (tagged/untagged/continuation
  plus `{n}` literals), `CAPABILITY` collection, STARTTLS gated on advertised
  support, `LOGIN`, SASL `AUTHENTICATE` (PLAIN/LOGIN/XOAUTH2) and a tagged
  command primitive.
- **SMTP** (`./smtp`): multiline EHLO parser, STARTTLS, SASL AUTH, the
  MAIL/RCPT/DATA transaction with RFC 5321 dot-stuffing, an RFC 5322 message
  builder with CRLF-injection guards, and a `sendTransaction` helper that RSETs
  on rejection.
  on rejection.

Authentication is fail-closed unless the connection is encrypted. The only
exception is `unsafeAllowInsecureAuthForTests: true`, accepted only when
`NODE_ENV=test`; it is intended solely for protocol-fixture tests.

## Zero-footprint dependency policy

This package deliberately declares **no dependencies** and adds **no lockfile
importer entries**, per the W16 ownership constraint (no `root`/`contracts`/lock
edits). It uses only Node built-ins, and its test/typecheck toolchain is resolved
from the workspace root (`typescript`, `vitest`, `@types/node`). The normalized
error shape is declared locally and is structurally identical to the
`@navin/contracts` envelope; the adapter layer maps it at the boundary.

The one mechanical consequence is that any workspace install will add an empty
importer stub (`packages/protocol-compat: {}`) to `pnpm-lock.yaml`. The
integrator must regenerate and commit the lockfile; this package does not edit it.

## Usage

```ts
import { ImapClient } from '@navin/protocol-compat/imap'
import { SmtpClient } from '@navin/protocol-compat/smtp'

const imap = await ImapClient.connect({ host, port: 143, tls: 'starttls' })
await imap.startTls()
await imap.authenticate('PLAIN', { username, password })

const smtp = await SmtpClient.connect({ host, port: 587 })
await smtp.startTls()
await smtp.sendTransaction({
  from: 'alice@example.test',
  to: ['bob@example.test'],
  subject: 'Hello',
  text: 'Body',
})
```

## Testing

All client and transport tests run against **real loopback TCP fixture servers**
(`tests/support/`), including a genuine TLS upgrade for STARTTLS using a
self-signed certificate generated at test time with OpenSSL. TLS tests skip
cleanly when OpenSSL is unavailable.

```bash
pnpm --filter @navin/protocol-compat test
pnpm --filter @navin/protocol-compat typecheck
```

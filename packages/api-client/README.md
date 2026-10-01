# @navin/api-client

Typed REST + SSE client for the Navin `navind` API. It owns the transport concerns that every
renderer (Mail Web, Control Web, Desktop, CLI) shares, and it deliberately contains no UI,
offline cache or domain business logic.

## What it provides

- **Separate Mail and Control clients** with **separate auth contexts** (`navin-mail` vs
  `navin-control`/CLI relying parties). Mail uses host-only cookie/BFF sessions; Control/CLI uses
  scoped bearer tokens.
- **Runtime schema validation** of every request and response body against `@navin/contracts`
  TypeBox schemas.
- **REST + SSE** over a real `fetch` transport, with SSE `Last-Event-ID` reconnect and server
  `retry:` support.
- **Bounded retry/backoff** with full jitter, `Retry-After` support, and idempotency-aware retry
  gating (unsafe methods are not retried without an idempotency key).
- **Timeout and cancellation** via `AbortSignal`, surfacing distinct timeout vs cancelled errors.
- **Idempotency and correlation IDs**: auto-generated idempotency keys for mutations/submissions,
  and a correlation id on every request plus response-request-id capture.
- **Explicit error hierarchy** mapped from both HTTP status codes and `NavinError` envelopes.

## Usage

```ts
import { ControlApiClient, MailApiClient, bearerAuthContext } from '@navin/api-client'

const control = new ControlApiClient({
  baseUrl: 'https://admin.example.com',
  auth: bearerAuthContext({ surface: 'cli', token: process.env.NAVIN_TOKEN! }),
})

const session = await control.getSetupSession('set_alpha')
const health = await control.health()

const mail = new MailApiClient({ baseUrl: 'https://mail.example.com' })
const page = await mail.query({ accountId: 'acc_company_01', position: 0, limit: 50 })
await mail.mutate({ accountId: 'acc_company_01', mutation: 'mark_read', targetIds: ['msg_01'] })

const subscription = control.events({
  onEvent: (event) => console.log(event.id, event.event, event.data),
})
// later
subscription.close()
```

## Testing

```bash
npm test        # real local HTTP fixture server, no network
npm run typecheck
npm run build
```

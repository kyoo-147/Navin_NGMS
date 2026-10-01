# @navin/mail-web

Navin Mail Web: a runnable, minimal Mail workspace that talks only to the
`navind` Mail BFF through the typed `@navin/api-client`. There is no fixture data
and no local mock backend.

## What it does

- Mail login against the `navin-mail` relying party.
- Loads the normalized upstream session (accounts + capabilities + configured
  sender) and mailboxes.
- Queries a mailbox and renders real threads with a local, minimal presentational
  shell over the typed API client.
- Reads a thread, and performs idempotent mutations (read/unread, star, archive,
  trash).
- Composes and sends mail. The From address and sender identity are read from
  the server session response — never hard-coded. Sending is disabled (fail
  closed) when the engine has no submission capability, the account is
  read-only, or the deployment has no configured sender identity. A retry keeps
  the same idempotency key, so the BFF deduplicates the submission.

## Run it

The app is a real Vite build with an `index.html` + `src/main.tsx` entry.

```bash
pnpm --filter @navin/mail-web dev       # Vite dev server (serves index.html)
pnpm --filter @navin/mail-web build     # production bundle in dist/
pnpm --filter @navin/mail-web preview   # serve the built bundle
```

Set `VITE_NAVIND_BASE_URL` to point at a `navind` origin other than the one
serving the bundle; otherwise the app uses `window.location.origin`.

## Embedding

`MailApp` takes a `clientFactory` so the token can be attached lazily after
login:

```tsx
import { MailApp, createMailClient } from '@navin/mail-web'

render(
  <MailApp
    clientFactory={(getToken) =>
      createMailClient({ baseUrl: 'https://mail.example.com', getToken })
    }
  />,
)
```

## Fail-closed behavior

When the daemon has no upstream mail binding, every Mail request returns
`503 SERVICE_UNAVAILABLE`. The sign-in form surfaces that error instead of
showing an empty or fabricated inbox.

## Bundle scope

The browser bundle depends only on `@navin/api-client` (plus React and the
design tokens CSS). It intentionally does not import `@navin/mail-ui` /
`@navin/mail-core` yet: those barrels currently re-export Node-only code
(`node:sqlite` via `mail-store`), which cannot be bundled for the browser. The
minimal presentational shell here is replaced by the shared Mail UI once those
packages expose a browser-safe entry point.

## Testing

- `tests/mail-app.test.tsx` drives the UI against a real `navind` process over
  a hermetic JMAP upstream with a temporary SQLite database — login, mailbox
  list, thread list, compose → submit → truthful result, idempotent retry, and
  the disabled-compose and fail-closed paths.
- `tests/bundle.test.ts` runs a real `vite build` and proves the bundle is
  produced from `index.html` with no account/engine data baked in.

# MERAK Product Requirements Document

**Status:** Phase 1 execution baseline, implementation in progress.
**Owner:** Navin Research.
**Product:** Merak, an operator-owned email platform with a daily Mail workspace and a bounded Control plane.
**Repository status:** This document defines requirements and contracts. It is not a production-readiness attestation.

## 1. Product outcome

Merak must let a technical owner operate a real email system and let mailbox users perform daily mail work without granting infrastructure authority.

The Phase 1 outcome is a verified end-to-end journey on a disposable target:

1. A Control user signs in and creates a persisted setup session.
2. Web, Desktop and CLI can reconnect to the same session and stable IDs.
3. The operator discovers a target, reviews a plan and exact diff, approves the required risk tier, applies changes, and verifies the observed result.
4. The operator provisions a domain, mailbox and routing identities through the owned daemon and an adapter boundary.
5. Mail users sign in through a separate Mail session, read, search, mutate, draft and send real mail through the normalized Mail API.
6. Migration, encrypted backup, isolated restore and evidence workflows are explicit and recoverable.
7. Optional AI can propose cited drafts or plans, but no-AI operation remains complete and AI cannot cross Mail and Control authority boundaries.

A capability is not accepted because source, a mock, a documentation statement or a unit test exists. Acceptance requires executable behavior, relevant negative paths, persistence/restart proof and appropriately classified evidence.

## 2. Users and permissions

| User | Primary job | Allowed surface |
| --- | --- | --- |
| Mail user | Read, search, compose and manage their mail | Mail |
| Mail delegate | Perform explicitly delegated mailbox work | Mail, scoped delegate actions |
| Organization administrator | Manage domains, people, aliases, groups and policy | Control |
| Operations operator | Inspect and execute approved operational work | Control and CLI |
| Security or backup administrator | Manage security, recovery and evidence workflows | Control and CLI |
| Developer or integration | Consume stable typed contracts | API and CLI |
| AI assistant | Explain and propose within a session-bound tool catalog | Mail or Control, never both implicitly |

Mail and Control have separate sessions, relying parties, scopes and tool catalogs. A remembered Desktop module is navigation state only. Backend authorization remains mandatory for every request.

Administrators have metadata-only access by default. Mail content access is separately authorized, audited and suitable for break-glass workflows.

## 3. Product principles

- Merak owns its product architecture, core, runtime, data model, identity, policies and operation.
- External products are research material only and cannot be a permanent Merak runtime core.
- One `navind` daemon owns authoritative application state for Web, Desktop and CLI.
- Mail engine state remains authoritative for actual mail resources. Merak normalizes and reconciles it; it never invents success.
- Mail and Control are visibly and technically separate.
- No-AI operation is complete and is the default fallback.
- Risky changes follow `discover -> plan -> diff -> approve -> apply -> verify -> result`.
- `queued`, `submitted`, `approved` and `accepted` are not proof of `applied` or `verified`.
- Unknown and partial outcomes become `needs_attention`, never hidden success.
- SSE accelerates updates. Durable state and refetch are the correctness path.
- Secrets, tokens, raw upstream authorization, message content and backup material never appear in URLs, normal logs, plans or ordinary audit payloads.

## 4. Phase 1 scope

### 4.1 Required

- Control setup shared by Web, Desktop and CLI.
- Domain, mailbox, alias and shared-address administration.
- Target discovery, readiness, DNS/TLS and sender-auth diagnostics.
- Mail login, mailbox navigation, threaded reading, search, compose, drafts, reply and forward.
- Read/unread, star, archive, trash, restore, move/copy and label mutations where capability permits.
- Server-authoritative query, bounded cache, realtime change notification and restart reconciliation.
- Idempotent submissions with truthful uncertain-send handling.
- Generic IMAP migration with discovery, mapping, baseline, delta, reconciliation and separately approved cutover.
- Encrypted backup, offsite copy, integrity verification and isolated restore drill.
- Jobs, approvals, audit and redacted evidence.
- Optional scoped AI and a complete no-AI path.
- Trusted operator-installed extension foundation and one first-party proof.
- Browser acceptance, protocol acceptance and packaged Windows Desktop proof.

### 4.2 Deferred

- Public extension marketplace or arbitrary third-party sandbox claims.
- MSP-scale tenancy, billing, white-label fleet management and multi-region HA.
- Kubernetes, Redis, brokers, GraphQL, gRPC, microservice splitting and generalized orchestration.
- Native mobile applications.
- SAML, SCIM, eDiscovery and legal hold.
- Unsupervised agent sending or infrastructure mutation.
- Pixel-identical recreation of another mail product.

## 5. Surface requirements

### 5.1 Mail Web and Desktop

The primary Mail loop is `sign in -> mailbox -> query -> thread -> reader -> compose/draft -> observed submission`.

The UI must:

- show real server data or an explicit unavailable/blocked state;
- keep infrastructure settings and Control actions out of Mail navigation;
- render sanitized HTML with plaintext fallback, blocked remote content by default and safe attachment handling;
- preserve stable account, thread, message and mutation IDs;
- disable send when the account, sender binding or engine capability does not permit it;
- show submission state, undo expiry and uncertain outcomes without claiming delivery;
- reconcile after reconnect or daemon restart before retrying a mutation or submission;
- support keyboard-visible focus, semantic controls, readable contrast, reduced motion and 44px minimum mobile touch targets.

### 5.2 Control Web, Desktop and CLI

Control renders the same persisted setup, action, job, approval and evidence records.

The primary mutation loop is `intent -> plan -> review -> approve -> execute -> verify -> result`.

The UI and CLI must show:

- current organization and instance context;
- observed state, desired state and exact diff;
- risk tier, required scopes, approval and step-up requirements;
- durable action/job IDs and reconnect instructions;
- blocked, unavailable, failed and needs-attention states;
- rollback eligibility and required confirmation;
- redacted evidence and limitations.

The CLI is a thin typed client. Human output is allowed, but `--json`, stable exit codes and the same IDs and error envelopes are required for automation. Non-interactive commands fail closed when confirmation, approval or secrets are required.

## 6. Backend architecture and ownership

```text
Mail Web/Desktop -> Mail session -> navind Mail BFF -> normalized mail gateway -> engine adapter
Control Web/Desktop/CLI -> Control session -> navind -> action/job/policy ledgers -> adapters
```

`navind` owns identity, sessions, scopes, setup state, action lifecycle, jobs, approvals, audit, evidence, events and configuration.

Adapters own protocol and target-specific details. Engine-specific identifiers and payloads must not cross the public contract boundary.

Initial runtime baseline is Node.js 22, TypeScript, Fastify, TypeBox/JSON Schema, SQLite WAL, React/Vite, Tauri 2, JMAP first with SMTP/IMAP compatibility, and a replaceable engine adapter.

## 7. API contract v1

All paths below are under `/api/v1`. The contract is additive and versioned. A route or contract type existing in source is not, by itself, proof that the complete product behavior is live.

### 7.1 Common transport rules

- Every response carries a correlation ID in the response header and error envelope.
- Errors use a stable envelope with `code`, `message`, `retryable`, `correlationId`, `timestamp` and optional redacted `details`.
- Expected codes include `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED`, `APPROVAL_REQUIRED`, `RISK_STEP_UP_REQUIRED`, `ACTION_BLOCKED`, `SERVICE_UNAVAILABLE` and `INTERNAL_ERROR`.
- A retried request with the same idempotency key and equivalent payload returns or reconciles the same result.
- Reusing an idempotency key for a different payload is a conflict.
- Read and plan routes do not mutate resources.
- Raw upstream credentials and mailbox passwords are never accepted in query strings or persisted plans.

### 7.2 Authentication and sessions

| Method | Path | Contract |
| --- | --- | --- |
| `POST` | `/auth/login` | Control or CLI login. Requires `x-navin-surface: control\|cli`, email and password. |
| `GET` | `/auth/session` | Current Control/CLI principal and scopes. |
| `POST` | `/auth/step-up` | Recent authentication for elevated actions. Returns an elevated token, assurance level and expiry. |
| `POST` | `/mail/auth/login` | Mail login with email and password. Issues a host-only Mail session. |
| `GET` | `/mail/auth/session` | Current Mail principal, account, roles, scopes and assurance. |
| `POST` | `/mail/auth/logout` | Revokes the Mail session and returns `{ loggedOut: true }`. |

Mail uses the `navin-mail` relying party and `mail` surface. Control uses the `navin-control` relying party and `control` or `cli` surface. The browser never receives upstream JMAP authorization values.

### 7.3 Mail API

| Method | Path | Required behavior |
| --- | --- | --- |
| `GET` | `/mail/session` | Return normalized accounts, primary account, engine capabilities and server-authoritative sender binding. |
| `GET` | `/mail/mailboxes?accountId=` | Return normalized mailbox inventory, counts, roles and rights. `accountId` is required. |
| `GET` | `/mail/messages/:messageId?accountId=` | Return one normalized message. `accountId` is required. |
| `GET` | `/mail/threads/:threadId?accountId=` | Return thread membership and message detail. `accountId` is required. |
| `POST` | `/mail/query` | Query one account with filter, sort, position, limit and optional total calculation. |
| `POST` | `/mail/mutations` | Apply an idempotent standard, folder or label mutation. |
| `POST` | `/mail/submissions` | Create or submit a message using an authorized sender identity and idempotency key. |
| `GET` | `/mail/events` | SSE change stream. `Last-Event-ID` or `cursor` resumes only within the process ring; clients refetch after restart. |

The Mail session response is:

```json
{
  "username": "alice@example.com",
  "state": "authenticated",
  "accounts": [{
    "accountId": "acc_example",
    "name": "Alice",
    "isPersonal": true,
    "isReadOnly": false,
    "mailCapable": true,
    "submissionCapable": true
  }],
  "primaryAccountId": "acc_example",
  "capabilities": {
    "mail": true,
    "submission": true,
    "vacation": false,
    "contacts": false,
    "calendars": false,
    "scheduledSend": false
  },
  "sender": { "identityId": "usr_example", "address": "alice@example.com" }
}
```

The example is illustrative only. IDs and addresses are server-owned and must not be hard-coded by clients.

A query request contains `accountId`, optional `filter` and `sort`, `position >= 0`, `1 <= limit <= 500`, and optional `calculateTotal`. The response contains `accountId`, `threadIds`, `messageIds`, `total`, `position`, `canCalculateChanges` and a non-empty `queryState`.

A mutation request is one of:

- standard: `mark_read`, `mark_unread`, `star`, `unstar`, `archive`, `trash`, `restore` or `delete`;
- folder: `move` or `copy` plus `destinationFolderId`;
- label: `apply_label` or `remove_label` plus `labelIds`.

All mutations require `accountId`, non-empty `targetIds` and `idempotencyKey`. The response contains `success`, the same `idempotencyKey`, `affectedCount`, `newState` and an optional `undoToken`.

A submission requires `accountId`, `senderIdentityId`, `idempotencyKey`, `from`, at least one `to`, subject and optional body, recipients, attachments, threading headers, `sendAt` and `undoDelaySeconds` from 0 to 60. The backend validates `senderIdentityId` and `from.address` against the configured sender binding. Supported statuses are `queued`, `scheduled`, `sent` and `held_for_undo`. A timeout or ambiguous response is not `sent` and must be reconciled using the same idempotency key.

When the upstream binding is absent, every Mail route fails closed with `503 SERVICE_UNAVAILABLE`. No synthetic inbox or fake send result is allowed.

### 7.4 Setup and Control API

| Method | Path | Contract |
| --- | --- | --- |
| `GET` | `/control/setup/sessions` or `/setup/sessions` | List persisted setup sessions. |
| `POST` | `/control/setup/sessions` or `/setup/sessions` | Create a session with title, intelligence mode, optional target and initial stage. |
| `GET` | `/control/setup/sessions/:sessionId` or `/setup/sessions/:sessionId` | Return the authoritative setup session and blocks. |
| `POST` | `/control/setup/sessions/:sessionId/resume` | Resume a paused or interrupted session. |
| `POST` | `/control/setup/sessions/:sessionId/{discover,plan,diff,approve,apply,verify}` | Run the named lifecycle command subject to scope, approval and step-up policy. |
| `GET` | `/control/setup/sessions/:sessionId/events` | Stream setup events with cursor support and restart reconciliation. |

A `SetupSession` contains stable `id`, `title`, `currentStage`, `status`, `intelligenceMode`, optional `targetHost`, ordered blocks, optional event cursor, `createdAt` and `updatedAt`.

Target hosts are `local`, `ssh_vps` with a pinned host-key fingerprint, or `remote_daemon` with a pinned TLS certificate fingerprint. Intelligence modes are `navin_managed`, `provider_byok`, `local_model` and `none`.

Organization routes are:

| Method | Path | Meaning |
| --- | --- | --- |
| `POST` | `/control/organization/domains/plan` | Read-only domain plan. |
| `POST` | `/control/organization/domains` | Confirmed domain apply. |
| `GET` | `/control/organization/domains/actions/:actionId` | Read action, attempts, job and evidence. |
| `POST` | `/control/organization/domains/actions/:actionId/rollback` | Authorized domain rollback. |
| `POST` | `/control/organization/aliases/plan` | Read-only alias plan. |
| `POST` | `/control/organization/aliases` | Confirmed alias apply. |
| `GET` | `/control/organization/actions/:actionId` | Read alias action. |
| `POST` | `/control/organization/actions/:actionId/rollback` | Authorized alias rollback. |
| `POST` | `/control/organization/mailboxes/plan` | Credential-free mailbox plan. |
| `POST` | `/control/organization/mailboxes` | Confirmed mailbox apply with apply-time password only. |
| `GET` | `/control/organization/mailboxes/actions/:actionId` | Read mailbox action. |
| `POST` | `/control/organization/mailboxes/actions/:actionId/rollback` | Tier 3 rollback with recent step-up and exact mailbox confirmation. |

Domain and alias apply requests require `confirm: true` and an optional idempotency key. Mailbox apply accepts an optional 12-256 character password only on the apply route. Passwords are not accepted during planning and must not enter action parameters, idempotency keys, jobs or audit records.

### 7.5 Action, job and evidence response

Every mutating Control response must identify the action and expose the same view shape:

```json
{
  "action": {
    "id": "act_example",
    "name": "organization.mailbox.create",
    "surface": "control",
    "stage": "verify",
    "status": "completed",
    "riskTier": 1,
    "parameters": {},
    "canRollback": true,
    "requestedBy": "usr_operator",
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:01Z"
  },
  "attempts": [],
  "job": {},
  "evidence": []
}
```

The concrete contract includes optional exact `diff`, verification, approval, error, attempts, job and evidence records. Action status values are `staged`, `planned`, `awaiting_approval`, `approved`, `rejected`, `applying`, `verifying`, `completed`, `failed`, `rolling_back`, `rolled_back` and `rollback_failed`.

A plan is not an apply. An apply is not a verification. A crash after an upstream side effect requires discovery and reconciliation before retry.

## 8. Data model and source of truth

### 8.1 Product-owned state in SQLite WAL

Persist:

- identities, sessions and assurance state;
- organization, target and setup sessions;
- setup blocks and event cursors;
- action, approval, attempt and idempotency ledgers;
- durable jobs, audit records and evidence references;
- provider and extension metadata;
- backup and migration run metadata.

### 8.2 Engine-authoritative state

The mail engine owns raw messages, folders/mailboxes, routing and delivery state. Merak stores normalized identifiers, bounded cache and synchronization metadata. Clients must not assume any upstream JMAP identifier format.

A normalized message contains ID, thread ID, mailbox IDs, keywords, read/star/draft/answered flags, attachment presence and metadata, subject, participants, timestamps, optional text/HTML bodies, attachments and threading headers.

A normalized mailbox contains ID, folder ID, name, parent, role, ordering, counts, subscription state and rights.

### 8.3 External facts

DNS, PTR, TLS, reputation, provider blocks and recipient classification are observed facts. Merak may diagnose and provide remediation evidence, but it cannot guarantee inbox placement.

### 8.4 Recovery invariants

- Jobs and action state survive daemon restart where supported.
- SSE is an update hint, not the durable record.
- Offline mutations and submissions use stable keys and reconcile against server state.
- Conflicts and uncertain results remain visible.
- Restore defaults to an isolated target and proves accounts, messages, attachments and metadata before any readiness claim.

## 9. Acceptance requirements

The Phase 1 release must pass the relevant G0-G8 gates from the acceptance model, including:

- contract, provenance, lint, typecheck and unit checks;
- real process and restart authorization tests;
- shared setup state across clients;
- real disposable engine and SMTP/IMAP/JMAP behavior;
- browser and packaged Desktop flows;
- migration baseline/delta/reconcile proof;
- encrypted backup, offsite copy and isolated restore proof;
- AI safety and no-AI parity;
- trusted extension permission, failure and audit proof;
- fresh-target readiness with limitations and owner sign-off.

Required negative tests include invalid or conflicting resources without mutation, insufficient scopes, stale step-up, forged sender, duplicate concurrent requests, crash after engine commit, unsupported capability, corrupt backup, network outage, hostile Mail content attempting Control actions and any production target appearing in an automated test manifest.

## 10. Traceability and implementation notes

This PRD is synthesized from the approved product documentation packet, repository contracts and current route implementations. The current source includes a working subset of the daemon, Control organization actions, setup routes, API client, Mail BFF and minimal Mail Web shell. Those implementations are evidence inputs, not a declaration that Phase 1 is accepted.

Implementation work must preserve the existing Phase 1 plan under `docs/implementation/`, the design baseline under `docs/design/`, the ownership policy in `docs/PRODUCT-OWNERSHIP-RULE.md` and the public-repository privacy rules in `AGENTS.md`.

No deployment-specific configuration, private evidence, real mailbox data, credentials, external source code or production claims belong in this document.

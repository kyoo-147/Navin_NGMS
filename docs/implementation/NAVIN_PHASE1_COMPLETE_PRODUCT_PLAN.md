# Navin Platform — Phase 1 Complete Product Plan

Status: **approved Phase 1 execution baseline; implementation in progress**
Date: 2026-10-01
Supersedes for Phase 1 sequencing only: `docs/implementation/NAVIN_BUILD_PLAN.md`
Authoritative product/design context:

- `docs/design/`
- `packages/contracts/`

## 1. Owner direction translated into an execution contract

Phase 1 is not a small MVP or a UI prototype. It must produce a real, locally operable Navin product with:

1. **Navin Mail** — broad Gmail-functional mail behavior on Web and Desktop.
2. **Navin Control** — complete first setup and core administration on Web and Desktop.
3. **Navin CLI** — a complete terminal renderer for the same Control plane.
4. **One `navind` daemon/API and one persisted product state** shared by the three surfaces.
5. **Real mail-engine operations and real protocols**, not mock success.
6. **Optional AI** with provider onboarding and a complete deterministic no-AI path.
7. **A small but real extension foundation** for trusted operator-installed extensions.
8. **Migration, encrypted backup, offsite copy, isolated restore drill and readiness evidence**.

The product must work before deep visual polish. UI work in Phase 1 is limited to functional shells, clear states and safe interactions. Core backend, data correctness, protocols, recovery and end-to-end evidence receive priority.

## 2. Source-study and implementation policy

Navin will implement its own product code. External repositories are **reference-only** unless the owner explicitly changes this policy later.

Allowed research use:

- architecture boundaries;
- protocol flows and RFC interpretation;
- state machines and failure handling;
- edge cases and security controls;
- test scenarios and acceptance design;
- operational behavior;
- UX behavior, without copying visual identity.

Not allowed in Phase 1:

- vendoring source from an external application;
- renaming copied files/functions and presenting them as Navin code;
- copying AGPL/GPL/no-license code;
- importing an external product as Navin's architectural base;
- reproducing Gmail branding, assets or distinctive pixel-identical UI.

Reusable third-party libraries are ordinary declared dependencies only after license, maintenance and security review. Their license notices and SBOM entries remain intact.

### 2.1 High-quality reference set

Study core engineering, not visual styling:

| Reference | What Navin studies | Local cache role |
|---|---|---|
| Gmail behavior | mental model, keyboard behavior, search syntax, thread/compose semantics | behavior baseline only |
| Fastmail Overture | observable state, local mutations, undo, query windows, sync design | reference-only |
| JMAP JS / IETF JMAP RFCs | method calls, batching, state tokens, changes and error semantics | standards reference |
| Thunderbird Android | mature sync, durable outbox, IMAP edge cases, message lifecycle | reference-only |
| Proton WebClients | mail rendering, phishing/remote-content defenses, privacy boundaries | reference-only |
| Stalwart | JMAP/admin behavior and engine capabilities | external engine behind adapter |
| Apache James | JMAP/admin boundaries and mail-processing pipeline | architecture reference |
| Mox | DNS, deliverability, ACME and simple-mail-server operational behavior | architecture/reference spike |
| Mach | local-first SQLite/FTS5, Tauri command boundaries and Gmail behavior | reference-only |
| Mail-0/Zero | modern compose/thread/AI interaction behavior | narrow reference-only |
| Tauri official plugins | deep links, updater, notification, store and capability ACL | approved-dependency candidates |
| Pi | extension registration and lifecycle ergonomics | architecture reference |

Rejected as primary references:

- abandoned clients with obsolete runtimes;
- demo-only JMAP clients as production architecture;
- repositories whose real implementation does not match their README;
- no-license repositories;
- UI clones without a proven protocol/data core.

Each studied repository receives a record in `docs/references/` containing URL, pinned commit, observed license, studied paths, conclusions and `code_imported: false`.

## 3. Phase 1 exit outcome

Phase 1 is complete only when this scenario works with executable evidence:

```text
fresh machine or disposable VM
→ start Navin Control on CLI, Web or Desktop
→ create/login local administrator or use supported identity login
→ connect an AI provider, Navin provider, local provider, or choose no-AI
→ create one persisted setup session
→ attach another Control renderer to the same session
→ connect local or remote disposable target
→ discover real host and mail-engine state
→ choose required capabilities
→ inspect architecture/resource preview
→ configure domain, users, aliases and groups
→ inspect plan and exact diff
→ approve according to risk tier
→ apply through the real engine adapter
→ verify mailbox authentication and internal/external protocol behavior
→ verify DNS/TLS/SPF/DKIM/DMARC evidence where an external test domain is available
→ migrate a fixture mailbox using baseline/delta/reconcile
→ create encrypted backup and offsite copy
→ restore into an isolated target and verify accounts/messages/attachments/metadata
→ open Navin Mail as two real users
→ send, receive, search, reply, mutate, schedule and recover mail
→ use contacts/calendar and realtime updates
→ exercise Mail through Web and packaged Desktop
→ use scoped Mail Assistant and Control Operator, then repeat core flow in no-AI mode
→ load and exercise one trusted first-party extension
→ restart navind and reconnect all clients
→ export the final readiness, audit and evidence bundle
```

Production VPS endpoints must not appear in automated acceptance configuration or network traces.

## 4. Architectural baseline

### 4.1 Runtime

One modular daemon:

```text
navind
├── configuration and migrations
├── identity and authorization
├── Mail and Control session issuers
├── setup-session state machine
├── action planner and runner
├── approvals and risk policy
├── jobs, events and SSE
├── audit and evidence
├── secrets/provider registry
├── mail gateway and normalized mail model
├── engine adapters
├── migration
├── backup and restore
├── AI catalogs/tool execution
└── trusted extension registry
```

Initial implementation stack:

- Node.js 22 + TypeScript;
- pnpm workspaces;
- TypeBox/JSON Schema contracts;
- Fastify REST + SSE;
- SQLite WAL;
- React + Vite thin renderers;
- Tauri 2 thin Desktop shell;
- JMAP first, IMAP/SMTP compatibility behind adapters;
- browser Mail clients call `navind` as the session-aware BFF/gateway; browser credentials are never forwarded directly to the mail engine;
- Vitest, Playwright and protocol-level acceptance.

No Kubernetes, message broker, Redis, GraphQL, gRPC, microservice split, WASM marketplace or custom rendering engine in Phase 1.

### 4.2 Repository layout

```text
apps/
  navind/
  cli/
  mail-web/
  control-web/
  desktop/

packages/
  contracts/
  api-client/
  auth/
  design-system/
  setup-core/
  action-core/
  mail-core/
  mail-store/
  mail-ui/
  control-ui/
  engine-core/
  engine-stalwart/
  engine-imap-smtp/
  migration-core/
  backup-core/
  ai-core/
  extension-core/
  test-support/

extensions/
  first-party/

tests/
  contract/
  integration/
  e2e/
  acceptance/
```

Boundary rules:

- Mail UI imports no Control domain module.
- Control UI imports no Mail workspace module.
- CLI imports contracts and API client, never React.
- Desktop owns native bridges only, never business logic.
- `navind` imports no frontend package.
- Engine-specific payloads do not leak through public contracts.
- AI tool catalogs are bound to a surface/session and cannot be switched implicitly.

### 4.3 Minimal contract freeze

Freeze only cross-worker/cross-process boundaries:

- identifiers and version envelope;
- `SetupSession`, `SetupBlock` and events;
- action lifecycle records;
- risk/approval records;
- job/event/error envelopes;
- audit/evidence records;
- auth/session identity and scopes;
- normalized mail query/mutation/submission contracts;
- engine-adapter interfaces;
- provider and extension manifests.

UI props, SQL internals and adapter internals remain free to evolve. Contract changes are additive and versioned.

## 5. Complete setup experience

Setup belongs only to Navin Control. CLI, Control Web and Control Desktop render the same persisted session and the same typed blocks.

### 5.1 Setup stages

1. **Welcome and execution mode**
   - local machine;
   - remote VPS over assisted SSH then pinned HTTPS;
   - attach to an existing Navin instance.
2. **Identity**
   - create local administrator;
   - login to existing local/Navin/external identity where configured;
   - configure recovery and MFA/passkey where supported.
3. **Intelligence**
   - connect provider by OAuth where supported;
   - add API-key provider;
   - connect OpenAI-compatible/local endpoint;
   - use Navin-managed provider when available;
   - or select no-AI.
4. **Intent and requirements**
   - organization/domain/users;
   - expected mailbox count/storage;
   - migration source;
   - backup destination and RPO/RTO;
   - selected capabilities.
5. **Target connection**
   - host fingerprint confirmation;
   - privilege and requirement checks;
   - never store raw SSH private keys.
6. **Discovery**
   - OS/resources/ports/DNS/listeners/firewall/proxy;
   - existing mail engine and version;
   - existing data/configuration;
   - compatibility warnings.
7. **Architecture preview**
   - selected engine/adapters/services;
   - storage and resource estimate;
   - excluded capabilities with reasons;
   - topology and recovery boundaries.
8. **Domain and DNS plan**
   - MX, SPF, DKIM, DMARC, MTA-STS/TLS-RPT, PTR evidence;
   - generate records and verify externally;
   - no implicit DNS mutation.
9. **Organization plan**
   - users, aliases, groups/shared addresses, quotas and roles.
10. **Plan, diff and approval**
    - exact intended state and exact changes;
    - risk tier and rollback availability;
    - typed confirmation/step-up where required.
11. **Apply**
    - idempotent steps;
    - truthful progress based on completed operations;
    - safe interruption and resume.
12. **Verify mail**
    - real account login;
    - internal SMTP/JMAP/IMAP send/receive;
    - external tests only in authorized disposable domain;
    - TLS and authentication evidence.
13. **Migration**
    - discovery and mapping;
    - baseline copy;
    - delta sync;
    - reconciliation;
    - separately approved cutover.
14. **Backup and restore**
    - comprehensive encrypted archive;
    - offsite copy;
    - integrity verification;
    - isolated restore drill;
    - sample/full reconciliation.
15. **Readiness and handoff**
    - pass/warn/block matrix;
    - unresolved risks;
    - evidence bundle;
    - operations and recovery instructions.

### 5.2 Shared state model

Each block has stable ID, session ID, schema version, kind, status, inputs, output, evidence, retry/rollback capability and dependencies.

Statuses:

```text
pending → ready → running → passed
                         ↘ warning
                         ↘ failed → retrying
                                  → blocked
passed → rollback_running → rolled_back | rollback_failed
```

A failed block only blocks dependants. It does not erase the session. All renderers reconnect with event cursor/`Last-Event-ID`, then reconcile from authoritative state.

### 5.3 Functional UI only

Control Web/Desktop use a simple shell:

- stage navigation;
- active block/form/diff;
- evidence/context panel where space allows;
- persistent job/recovery status;
- loading, empty, error, disabled and long-data states.

No dashboard decoration, elaborate motion or full component-library build is on the critical path.

## 6. Navin Mail Phase 1 functional scope

Gmail is the behavioral baseline. Navin implements its own UI and core.

### 6.1 Core mailbox loop

- Mail-specific login/session;
- Inbox, Starred, Snoozed, Sent, Drafts, Scheduled, Spam, Trash and All Mail;
- custom and nested folders/labels;
- dense virtualized message list;
- pagination/windowed queries;
- unread, star, importance, attachment and timestamp states;
- thread grouping and stable ordering;
- read/unread, star, archive, move/copy/label, spam, trash and restore;
- drag/drop, bulk operations and select-all across query;
- Gmail-familiar keyboard behavior.

### 6.2 Reader and security

- sanitized HTML and plain-text fallback;
- sandboxed rendering without scripts;
- remote images and tracking pixels blocked by default;
- inline CID handling;
- quoted-content collapse;
- attachment preview/download;
- raw source and authentication headers;
- suspicious-link/phishing indicators;
- unsubscribe where standards and message context allow;
- print and EML export.

### 6.3 Compose and delivery

- rich and plain text;
- To/Cc/Bcc and recipient autocomplete;
- reply, reply-all and forward;
- identity/alias selection and signatures;
- inline images and attachments with progress/cancel/retry;
- draft autosave and cross-client draft recovery;
- templates;
- scheduled send;
- snooze;
- truthful undo-send delay;
- missing-recipient/attachment warnings;
- size-limit handling;
- idempotent submission;
- visible delivery failure and retry state;
- correct `Message-ID`, `In-Reply-To` and `References` behavior.

### 6.4 Search, automation and sync

- real server search;
- Gmail-familiar operators mapped to normalized query contracts;
- search chips and saved searches;
- filter/rule builder and server capability mapping;
- vacation responder;
- JMAP state changes/EventSource and adapter equivalent;
- reconnect, delta reconciliation and duplicate protection;
- bounded browser durable cache: headers/snippets and bodies already opened during the last 30 days, capped by configurable storage quota; attachments are cached only after explicit open/download;
- offline drafts and queued mutations/submissions use stable idempotency keys;
- reconciliation is server-authoritative for mailbox state, field-aware for drafts, and never silently duplicates a send;
- conflicts that cannot be merged become visible `needs_attention` records rather than last-write-wins data loss.

### 6.5 Contacts and calendar

Contacts:

- CRUD, groups, autocomplete and duplicate handling;
- vCard/CSV import/export;
- JMAP Contacts/CardDAV adapter boundary;
- optional organization directory/GAL read path.

Calendar:

- day/week/month/agenda;
- CRUD, recurrence and exceptions;
- timezones, reminders, attendees and RSVP;
- `.ics` preview/import and invitation handling;
- create event from mail;
- JMAP Calendar/CalDAV adapter boundary.

### 6.6 Multi-account and settings

- identities and aliases;
- multi-account/unified inbox;
- density/theme/language/notification preferences;
- per-account signatures and compose defaults;
- responsive and keyboard-accessible behavior.

Visual polish beyond a coherent functional shell is deferred; functionality is not.

## 7. Navin Control Phase 1 scope

Functional sections:

1. Setup and readiness.
2. Organization overview.
3. Domains and DNS evidence.
4. Users, aliases, groups/shared addresses and quotas.
5. Delivery, queue and rejection diagnostics.
6. TLS, authentication, security sessions and MFA policy.
7. Migration jobs and reconciliation.
8. Backups, offsite copies, integrity and restore drills.
9. Jobs, approvals, audit and evidence.
10. AI provider configuration.
11. Trusted extensions.
12. System/update status with rollback evidence.

Every mutation enters the shared lifecycle:

```text
discover → plan → diff → approve → apply → verify → result → rollback
```

Risk policy:

- Tier 0: read/discover, immediate.
- Tier 1: reversible resource mutation, ordinary confirmation.
- Tier 2: shared infrastructure/configuration, explicit diff approval.
- Tier 3: destructive restore, deletion and MX cutover, typed confirmation plus recent authentication; never bypassed by `--yes`.

## 8. Navin CLI Phase 1 scope

CLI is a thin Control client. Required namespaces:

```text
navin bootstrap
navin login|logout|whoami
navin context add|list|use|remove
navin setup start|show|resume|blocks|plan|diff|approve|apply|verify|retry|rollback|evidence
navin status
navin doctor
navin domain ...
navin user ...
navin alias ...
navin group ...
navin dns ...
navin delivery status|queue|inspect|retry
navin migrate start|status|resume|reconcile|cutover
navin backup run|list|verify|copy
navin restore plan|apply|drill
navin ai provider list|set|test|remove
navin extension list|install|enable|disable|update|remove
navin secrets set|rotate|revoke
navin jobs ...
navin approvals ...
navin evidence show|list|export
navin events
navin logs
```

Contract requirements:

- human output by default;
- stable `--json` envelopes;
- stable exit codes;
- non-interactive mode fails closed when input/approval is required;
- no secret or token in normal logs;
- same IDs, blocks, risk, evidence and errors as Web/Desktop;
- disconnect resumes by job/session ID rather than repeating an action.

Existing shell scripts may be wrapped behind typed adapters temporarily only if they are made idempotent, emit structured results and run solely in disposable acceptance. The public CLI never depends on script output formats.

## 9. Desktop Phase 1 scope

One Tauri 2 app:

- lazy-load Mail and permission-gated Control modules;
- ordinary users do not receive Control navigation;
- server-side authorization remains authoritative;
- OS keychain/credential manager for refresh material;
- deep-link/OAuth callback and single-instance behavior;
- file picker, notifications, tray and signed updater bridges;
- local and remote `navind` profiles with isolated sessions;
- SSE reconnect/resume;
- Windows NSIS package as primary proof;
- MSI/portable package are secondary if packaging pipeline remains straightforward.

No mail parsing, setup action, AI execution or engine logic lives in Rust/Tauri shell code.

## 10. Identity and AI-provider onboarding

### 10.1 Identity

- local administrator is first-class and works without Navin cloud;
- optional Navin/external identity integrations;
- one identity authority may serve both products, but Mail and Control use separate relying parties, audiences and host-only sessions;
- scoped RBAC, resources, environment, risk and session assurance checked by backend;
- CSRF protection and session rotation;
- recovery and step-up for high-risk operations;
- no privileged parent-domain cookie.

### 10.2 Provider onboarding

Supported provider shapes:

- OAuth-capable provider;
- API-key provider;
- OpenAI-compatible endpoint;
- local provider such as Ollama-compatible service;
- Navin-managed provider when available;
- `none`.

Onboarding records endpoint/provider/model choices, masks secrets, tests authentication, structured output/tool capability and records latency as observed evidence rather than a guarantee.

Core functionality never depends on AI availability.

## 11. Scoped AI in Phase 1

Mail Assistant catalog:

- summarize;
- extract action items;
- draft/rewrite;
- translate;
- suggest follow-up;
- find related mail;
- propose meeting/event.

It may create drafts or proposals but never autonomously send mail in Phase 1.

Control Operator catalog:

- explain discovery;
- diagnose from approved evidence;
- propose architecture/capabilities;
- generate an action plan/diff;
- explain failures and recovery;
- invoke only registered deterministic tools with the current operator scope.

It cannot grant its own approval, bypass risk policy, access Mail bodies by default or convert untrusted email content into Control tool calls.

Required security proof is deterministic: a Mail session receives a catalog that contains zero Control tool schemas, the backend rejects cross-surface tool names even if a model emits one, and malicious email fixtures produce no Control action/job/audit record. LLM wording quality is not the security boundary.

## 12. Extension foundation

Phase 1 supports trusted operator-installed code only. It makes no sandbox claim and has no public marketplace.

Required foundation:

- manifest, version and compatibility validation;
- install/enable/disable/update/remove lifecycle;
- declared capabilities and backend enforcement;
- extension config and encrypted secrets;
- events/actions/providers and limited UI registrations;
- failure containment, timeout, health and audit;
- versioned host API.
In Phase 1 these registrations are typed host declarations resolved at startup. There is no hot-reload framework, arbitrary frontend code injection or generalized sandbox. UI pages/slots accept only explicitly allowed surface-scoped registrations.

Registration surface:

```text
registerCapability()
registerCommand()
registerRoute()
registerEventHandler()
registerAction()
registerEngineAdapter()
registerDeployAdapter()
registerDnsProvider()
registerTlsProvider()
registerMigrationConnector()
registerBackupTarget()
registerRelayProvider()
registerAiProvider()
registerIdentityProvider()
registerNotificationProvider()
registerUiPage()
registerUiSlot()
registerSchedule()
registerPolicy()
```

Cross-client prompts use typed `confirm`, `select`, `input`, `secret`, `editor`, `notify`, `setStatus` and `setProgress` requests. Disconnect/timeout fails closed.

At least one first-party extension must be exercised end to end; provider adapters may ship through the same extension contract where practical.

## 13. Real operational scope

Phase 1 includes:

- local/disposable target discovery;
- assisted remote SSH bootstrap and pinned HTTPS control connection;
- domains/users/aliases/groups provisioning;
- DNS generation and external verification;
- TLS evidence;
- SPF/DKIM/DMARC checks;
- migration baseline/delta/reconcile;
- encrypted backup;
- offsite copy to one selected reference target;
- isolated restore drill;
- readiness report;
- explicit tier-3 cutover action, tested only with authorized disposable DNS/domain.

Decisions still required before implementation reaches these tasks:

- minimum supported VPS profile; proposed baseline is 2 vCPU, 4 GB RAM and 40 GB storage, while lower-memory operation remains a later measured optimization;
- default remote path; proposed default is assisted SSH bootstrap followed by pinned HTTPS, with an SSH tunnel only as recovery/fallback;
- antivirus default; proposed default is capability-detected and off on constrained hosts rather than silently exhausting memory;
- reference offsite backup target; proposed contract is S3-compatible object storage with one concrete provider selected for acceptance;
- disposable external domain/IP/PTR resources; hermetic CoreDNS/SMTP fixtures cover deterministic CI, while public DNS/PTR/port-25 evidence is a separate external gate and cannot be claimed without authorized resources.

Unknown decisions must be represented as plan blockers, not silently guessed.

## 14. Fast execution strategy

Speed comes from parallel ownership and continuous integration, not by dropping promised scope.

### 14.1 Tier 0 — start simultaneously

| Worker | Exclusive ownership | Output |
|---|---|---|
| W00 | root workspace/CI | buildable pnpm/TS workspace and gates |
| W01 | `packages/contracts` | minimal contracts v1 |
| W02 | `docs/references`, dependency policy | provenance, allowlist, SBOM |
| W03 | disposable environment | real Stalwart/users/domain fixtures |
| W04 | token generation only | generated CSS/TS and drift/contrast checks |
| W05 | acceptance harness skeleton | evidence bundle and protocol capture |

### 14.2 Tier 1 — after minimal contracts

| Worker | Exclusive ownership |
|---|---|
| W10 | `apps/navind` kernel, migrations, health, config |
| W11 | `packages/auth` and session issuers |
| W12 | `packages/api-client` |
| W13 | `packages/action-core` and job/event/evidence ledger |
| W14 | `packages/engine-core` + Stalwart admin adapter |
| W15 | normalized JMAP/mail gateway |
| W16 | IMAP/SMTP compatibility adapter |
| W17 | minimal design primitives |
| W18 | Tauri shell/native bridges |

### 14.3 Tier 2 — broad functional work in parallel

| Worker | Exclusive ownership |
|---|---|
| W20 | setup state machine and blocks |
| W21 | CLI renderer and command tree |
| W22 | Control Web functional shell |
| W23 | Mail list/thread/reader |
| W24 | compose/draft/MIME/submission |
| W25 | search/labels/filters/realtime |
| W26 | contacts/calendar |
| W27 | cache/offline outbox/reconciliation |
| W28 | migration connector |
| W29 | backup/offsite/restore |

Mail-path ownership is split further to prevent collisions:

- W23: `packages/mail-ui/src/list/**`, `packages/mail-ui/src/thread/**`, `packages/mail-core/src/thread/**`;
- W24: `packages/mail-ui/src/compose/**`, `packages/mail-core/src/draft/**`, `packages/mail-core/src/submission/**`;
- W25: `packages/mail-ui/src/search/**`, `packages/mail-core/src/query/**`, `packages/mail-core/src/realtime/**`;
- W26: `packages/mail-ui/src/contacts/**`, `packages/mail-ui/src/calendar/**`, and their domain modules;
- W27: `packages/mail-store/**`.

Shared export files are changed by one designated integrator, never concurrently by feature writers.

### 14.4 Tier 3 — integration features

| Worker | Exclusive ownership |
|---|---|
| W30 | DNS/TLS/deliverability actions |
| W31 | organization/admin actions |
| W32 | AI provider registry and secrets |
| W33 | Mail Assistant tools |
| W34 | Control Operator tools |
| W35 | extension host/manifest/lifecycle |
| W36 | first-party extension proof |
| W37 | Desktop composition and Windows package |
| W38 | security/adversarial test corpus |

### 14.5 Tier 4 — convergence

- integrate small results continuously;
- run vertical gates after each merged slice;
- resolve contract changes centrally and additively;
- run the complete disposable acceptance suite;
- produce the Phase 1 readiness/evidence bundle.

One writer owns each path. Parallel workers use isolated worktrees. The Master reviews, integrates and verifies; worker completion text is never treated as acceptance.

### 14.6 Critical path

```text
contracts
→ navind/auth/action ledger
→ real engine adapter
→ setup state machine
→ operational actions
→ migration + backup/restore
→ readiness verification
→ complete cross-surface acceptance
```

Parallel Mail critical path:

```text
mail contracts
→ normalized JMAP gateway and mail store
→ list/thread/reader + compose/submission
→ search/realtime/productivity/offline
→ Web and packaged Desktop Mail acceptance
```

Desktop shell, AI and extension tracks start as soon as their narrow contracts exist and run alongside both critical paths.

## 15. Integration gates

### G0 — foundation

- workspace builds;
- contracts compile and are versioned;
- license/unknown dependency gate works;
- tokens have zero drift;
- disposable environment definition contains no production endpoint.

### G1 — daemon and action spine

- real `navind` + SQLite migrations;
- auth and separate sessions;
- SSE reconnect;
- discover → plan → diff → approve → apply → verify → result → rollback;
- evidence survives restart.

### G2 — shared setup

- CLI creates a session;
- Control Web and packaged Desktop resume it;
- all render identical IDs/status/evidence;
- interruption and retry do not repeat completed mutations.

### G3 — real provisioning

- real domain/user/alias/group operations against disposable engine;
- mailbox login succeeds;
- internal send/receive succeeds;
- failure produces truthful blocked/rollback evidence.

### G4 — complete Mail

- two users exercise list/thread/read/compose/reply/attachments/search/mutations;
- realtime delivery without manual reload;
- drafts and scheduled mail survive restart;
- snooze returns at the expected time;
- labels/filters/templates/vacation work;
- contacts/calendar/invitation flow works;
- offline queued operations reconcile without duplicate sends;
- unsafe HTML is contained;
- Web and packaged Desktop share the same server state.

### G5 — operations and recovery

- DNS/TLS/authentication evidence;
- hermetic DNS/TLS/authentication checks always run in CI; public DNS, PTR and external port/delivery evidence are required only when authorized disposable external resources exist and are reported separately;
- fixture migration baseline/delta/reconcile;
- encrypted backup and offsite copy;
- isolated restore reconstructs raw messages, attachments, metadata, conversations and account objects;
- restored samples authenticate and can be read/searched;
- cutover test is isolated and separately approved.

### G6 — AI and no-AI

- provider setup/test/revoke works;
- Mail Assistant produces a draft but cannot send autonomously;
- Control Operator produces a plan but cannot self-approve;
- email prompt injection cannot invoke Control tools;
- complete deterministic flow passes with AI disabled/unreachable.

### G7 — extensions

- signed/trusted local package or development extension installs;
- manifest/capability/version validation works;
- one action/provider and one correctly scoped UI registration work;
- wrong-surface registration is rejected;
- failure/timeout is contained and audited;
- secrets do not appear in logs/events/UI.

### G8 — Phase 1 exit

- all previous gates pass in a fresh disposable environment;
- no production host was contacted;
- Web, Desktop and CLI evidence is collected;
- Windows packaged-app proof exists;
- limitations and unverified external deliverability claims are explicit;
- owner can follow operations documentation without developer intervention.

## 16. Acceptance evidence classes

Never collapse these categories:

1. unit/contract tests;
2. local process integration;
3. real mail-protocol integration;
4. browser E2E;
5. packaged Desktop proof;
6. disposable VM/VPS operations;
7. external DNS/network evidence;
8. migration evidence;
9. backup/restore evidence;
10. manual owner acceptance.

A green unit or browser test cannot claim packaged Desktop, external network, restoration or production readiness.

## 17. Deliberately not optimized in Phase 1

- pixel-perfect or highly polished UI;
- animation system beyond functional feedback;
- public extension marketplace;
- untrusted extension sandbox claims;
- MSP multi-tenancy, billing and white-label control plane;
- Kubernetes/distributed control plane;
- SAML/SCIM/eDiscovery/legal hold;
- mobile-native applications;
- autonomous sending or autonomous infrastructure mutation;
- production cutover.

These exclusions do not remove any functional Phase 1 item listed above.

## 18. First implementation batch after approval

Start these together in isolated worktrees:

1. workspace/CI;
2. contracts v1;
3. reference/provenance records;
4. disposable Stalwart acceptance environment;
5. token generation and minimal primitives;
6. `navind` kernel/SQLite/health/SSE;
7. auth/session spike;
8. engine adapter/discovery spike;
9. Mail JMAP query/submission spike;
10. CLI block renderer;
11. Control Web block renderer;
12. Tauri shell and secure-store/deep-link spike.

The first integration target remains small but real:

```text
one persisted setup session
+ three Control renderers
+ real discovery
+ one reversible mailbox/alias action
+ real mailbox login/send/receive
+ restart/resume/evidence
```

Passing this target does not end Phase 1. It unlocks the remaining parallel workstreams through Gate G8.

## 19. Owner review checklist

Please confirm or modify:

1. Navin source remains independently implemented; cloned repositories are reference-only.
2. Phase 1 includes all functionality in Sections 5–13, while UI remains functional rather than polished.
3. Stalwart remains the first engine used for real acceptance behind a replaceable adapter.
4. JMAP is first-class; IMAP/SMTP compatibility remains required.
5. Calendar and Contacts are included in Phase 1.
6. Offline scope is durable drafts/outbox/mutations and cached reading, not an unlimited offline mirror.
7. One trusted first-party extension and scoped AI are required Phase 1 proofs.
8. No production mutation or production automated acceptance occurs.
9. Open decisions in Section 13 must be answered before their dependent actions can pass acceptance.

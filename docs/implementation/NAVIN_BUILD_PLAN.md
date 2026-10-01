# Navin Platform — Implementation Plan

Status: **approved architecture baseline; implementation in progress**
Date: 2026-09-30
Authoritative design baseline: `docs/design/`

## 1. Outcome

Build a real, self-owned Navin product with three surfaces over one platform:

1. **Navin Mail** — Gmail-familiar daily mail workspace.
2. **Navin Control** — setup, administration and infrastructure operations.
3. **Navin CLI** — terminal client for the same Control plane.

Delivery channels:

| Surface | Web | Desktop | Terminal |
|---|---:|---:|---:|
| Mail | Yes | Yes | No daily inbox |
| Control | Yes | Yes, permission-gated | Yes |
| CLI | No | Optional later | Yes |

The first product proof is not a screenshot or static scaffold. It is:

```text
local admin login
→ connect AI provider or choose no-AI
→ create/resume one setup session
→ discover a disposable target
→ propose mailbox + alias changes
→ approve
→ apply against a real mail engine
→ verify login and mail delivery
→ see the same persisted result in CLI, Control Web and Control Desktop
```

## 2. Non-negotiable constraints

- Navin owns its Mail UI, Control UI, CLI, daemon, contracts and action model.
- External source checkouts are reference-only unless a dependency is explicitly approved after license review.
- Do not copy Gmail branding, assets, source or a pixel-identical distinctive design.
- Do not import AGPL/GPL/no-license source into Navin.
- Do not write a new SMTP/IMAP server in v1.
- Keep a replaceable mail-engine boundary.
- No Kubernetes, Kafka, RabbitMQ, Redis, GraphQL, gRPC, WASM marketplace or microservice split in v1.
- AI remains optional; deterministic no-AI operation is complete.
- No product mock backend or fake success state.
- Unit tests may use fakes for isolated failure cases; milestone acceptance must use real processes, SQLite and mail protocols.
- Do not touch the current production VPS during development acceptance.
- Mail and Control are separate builds and separate authorization surfaces.
- Desktop is a thin shell; no Desktop-only business logic.
- Dangerous changes require plan, diff, explicit approval, verification and rollback.
- Every completion claim requires executable evidence.

## 3. Design pack adoption

`docs/design/` is mandatory context for every frontend worker.

### 3.1 Canonical token flow

Use `docs/design/navin-tokens.json` as the authored token source after reconciliation, then generate:

```text
packages/design-system/src/generated/tokens.css
packages/design-system/src/generated/tokens.ts
packages/design-system/src/generated/tailwind-theme.ts
```

Keep `docs/design/navin-tokens.css` as a readable reference/export. Add a drift test so JSON, generated CSS and TypeScript cannot silently disagree.

### 3.2 Reconciliation required before UI work

Current pack gaps to close without changing its visual direction:

- dark equivalents for disabled text, divider and status/soft colors;
- typography families, sizes and weights;
- button/input/icon size tokens;
- icon stroke width;
- focus-ring tokens;
- breakpoints;
- z-index layers;
- complete motion and reduced-motion mapping;
- component density values;
- token contrast tests.

### 3.3 UI rules

- No gradients or glassmorphism.
- No purple/blue “AI theme.”
- Lucide only.
- Semantic tokens only; no random hardcoded colors.
- Shadows only on floating layers.
- Mail rows are rows, not cards.
- Control is intent-first and evidence-first.
- Empty, loading, error, disabled and long-data states are required.
- Mail and Control share primitives, not page templates.
- Build components when a vertical slice needs them; do not prebuild the entire inventory.

## 4. Target repository shape

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
  design-system/
  auth/
  engine-core/
  engine-stalwart/
  engine-imap-smtp/
  mail-ui/
  control-ui/
  agent-ui/
  test-support/

extensions/
  first-party/

tests/
  contract/
  integration/
  e2e/
  acceptance/

docs/
  design/
  implementation/
  references/
```

Boundary rules:

- `mail-web` cannot import `control-ui`.
- `control-web` cannot import `mail-ui`.
- `cli` imports contracts and API client, never React/UI packages.
- `navind` imports contracts and adapters, never frontend packages.
- Desktop composes Mail and Control modules but owns no domain operations.
- Cross-package imports use workspace package names, never `../../` across roots.

## 5. Technology baseline

Use the smallest stack already justified by the research:

| Layer | Initial choice |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Workspace | pnpm workspaces |
| Schemas | TypeBox + JSON Schema |
| Daemon | Fastify REST + SSE |
| Control state | SQLite WAL |
| Web | React + Vite |
| Components | Radix/shadcn-style primitives using Navin tokens |
| Icons | Lucide |
| Desktop | Tauri 2 thin shell |
| Mail | Adapter boundary; JMAP first where available, IMAP/SMTP compatibility |
| Testing | Vitest, Playwright, real disposable mail-engine stack |

Do not add a monorepo orchestrator until plain pnpm scripts become measurably insufficient.

## 6. Runtime boundaries

V1 remains one modular daemon:

```text
navind
├── config
├── identity
├── authorization
├── setup sessions
├── action lifecycle
├── jobs
├── approvals
├── audit
├── events/SSE
├── mail gateway
├── engine adapters
├── AI provider registry
└── extension registry
```

External namespaces:

```text
/api/v1/auth/*
/api/v1/mail/*
/api/v1/control/*
/api/v1/setup/*
/api/v1/events/*
```

Mail and Control use separate server authorization policies and separate host-only browser sessions.

## 7. Shared action lifecycle

Every Control mutation implements:

```text
discover
→ plan
→ diff
→ approve
→ apply
→ verify
→ result
→ rollback when supported
```

Core records:

- `ActionDefinition`
- `ActionPlan`
- `ActionRisk`
- `ApprovalRecord`
- `Job`
- `JobEvent`
- `VerificationResult`
- `Evidence`
- `RollbackResult`
- `AuditRecord`

Risk tiers:

| Tier | Example | Behavior |
|---|---|---|
| 0 | status/discovery | immediate |
| 1 | reversible mailbox/alias creation | ordinary confirmation; automation policy may allow |
| 2 | shared proxy/firewall/config | explicit diff approval |
| 3 | MX cutover, destructive restore, mailbox deletion | typed confirmation + recent authentication; never bypassed by `--yes` |

## 8. Build waves

### Wave 0 — Foundation and license gate

Goal: create the smallest buildable workspace and freeze shared contracts.

Tasks:

1. Root workspace: `package.json`, `pnpm-workspace.yaml`, TypeScript config, lint/typecheck/test scripts.
2. `packages/contracts`: setup blocks, action lifecycle, errors, SSE events and surface identity.
3. `packages/design-system`: reconcile/generate tokens and implement only required primitives.
4. `docs/references`: repository URL, pinned commit, observed license and studied behavior.
5. Disposable acceptance environment definition; no production endpoints.
6. License allowlist, unknown-license failure and initial SBOM command.

Required design primitives for the first slice only:

- Button/IconButton;
- Input/Select/Radio;
- Dialog/AlertDialog;
- InlineAlert;
- Progress/Skeleton;
- StatusDot/Badge;
- SetupBlock;
- PlanBlock;
- DiffBlock;
- ApprovalBlock;
- EvidenceBlock;
- JobStatus.

Gate W0:

- fresh install succeeds from lockfile;
- lint/typecheck/unit tests pass;
- generated tokens have zero drift;
- light/dark token contrast checks pass;
- no unknown or prohibited direct runtime license;
- no source copied from reference checkouts.

### Wave 1 — Real Control setup spine across all three experiences

Goal: prove shared backend/state rather than build broad UI.

Tasks:

1. `navind` boot, config and health.
2. SQLite migrations for users, sessions, setup sessions, setup blocks, jobs, approvals, evidence and audit.
3. Local administrator bootstrap/login.
4. Separate Control browser session and CLI token flow.
5. Provider step:
   - OpenAI-compatible endpoint;
   - Ollama/local endpoint;
   - no-AI;
   - Navin AI appears only when a real Navin service is configured.
6. Persisted setup session and typed setup blocks.
7. Read-only target discovery.
8. One real reversible action: create a mailbox and alias through `MailEngineAdapter`.
9. Verification: authenticate as the new mailbox and perform internal send/receive.
10. Control Web renders the setup journey.
11. CLI renders the same session, blocks, IDs and evidence.
12. Desktop packages the same Control module and resumes the same session.

No separate business logic is allowed in the three renderers.

Gate W1 — required end-to-end evidence:

```text
CLI creates setup session
Control Web resumes it
Desktop resumes it
real discovery runs
mailbox + alias plan is persisted
approval is recorded
real engine mutation occurs
mailbox login succeeds
message send/receive succeeds
audit/evidence survives navind restart
```

### Wave 2 — Navin Mail first real loop

Goal: replace “mail UI scaffold” with a usable mail client loop.

Slice M1 — authentication and mailbox navigation:

- Mail-specific session;
- mailbox/folder list;
- Inbox, Starred, Snoozed, Sent, Drafts, Scheduled, Spam and Trash navigation;
- loading, empty, error and reconnect states.

Slice M2 — list/read/thread:

- paginated message query;
- dense mail rows;
- thread grouping;
- sanitized HTML and text fallback;
- block remote images by default;
- quoted-content collapse;
- attachment metadata.

Slice M3 — compose/send/reply:

- compose;
- reply/reply-all/forward;
- draft autosave;
- upload/download attachments;
- sender identities and aliases;
- send through real engine;
- server failure and retry state;
- optional undo-send delay implemented truthfully.

Slice M4 — mutations/search/realtime:

- read/unread;
- star;
- archive;
- move/label;
- spam/trash/restore;
- real server search;
- JMAP changes/event stream or adapter equivalent;
- reconnect and state reconciliation.

Gate W2:

- two real users on a disposable engine;
- user A sends text + attachment to user B;
- user B receives without reload, reads and replies;
- thread appears for both users;
- draft survives restart;
- search finds the message;
- unsafe HTML fixture is contained;
- no infrastructure navigation exists in Mail.

Do not add browser SQLite/offline sync to the critical path. Add it only after the online mail loop is stable and measured.

### Wave 3 — Complete Control setup and operational safety

Goal: complete the setup journey without prematurely polishing it.

Add:

- remote VPS SSH bootstrap followed by pinned HTTPS API;
- host fingerprint confirmation;
- requirements brief and capability selection;
- architecture/resource preview;
- domain/user/group/alias provisioning;
- DNS record generation and external verification;
- TLS evidence;
- SPF/DKIM/DMARC checks;
- migration baseline/delta/reconcile;
- encrypted backup;
- offsite copy;
- isolated restore drill;
- readiness report;
- explicit MX cutover as a separate tier-3 action.

Gate W3:

- complete setup on a disposable VPS/VM from each renderer;
- interrupt and resume during a long-running job;
- force a failed apply and prove rollback/blocked state;
- restore into an isolated target and verify message/account samples;
- prove production VPS was not contacted.

### Wave 4 — Gmail-functional baseline expansion

Implement in independently shippable slices:

1. labels and nested folders;
2. filters/rules;
3. snooze;
4. scheduled send;
5. templates/signatures;
6. vacation responder;
7. bulk actions and keyboard navigation;
8. contacts and autocomplete;
9. calendar and invitations;
10. multi-account/unified inbox;
11. personal settings;
12. accessibility and responsive behavior;
13. offline cache and durable mutation outbox after online correctness;
14. import/export and open-format portability.

Each slice must use real server behavior and include failure/reconnect acceptance. The Phase 1 plan and shared contracts are authoritative for feature scope.

### Wave 5 — Scoped AI

Only after deterministic Mail and Control actions work.

Mail AI tool catalog:

- summarize;
- action items;
- draft/rewrite;
- translate;
- related mail;
- follow-up suggestions;
- meeting creation.

Operator AI tool catalog:

- discover;
- diagnose;
- generate a typed plan;
- explain diffs;
- migration/backup guidance;
- invoke only authorized deterministic actions.

Requirements:

- separate Mail and Operator sessions/tool catalogs;
- visible context;
- no AI-required setup;
- no autonomous approval;
- no autonomous external send in v1;
- provider data policy and secret storage visible;
- prompt-injection test proving mail content cannot call Control tools.

### Wave 6 — Extensions

After first-party actions and boundaries are stable:

- trusted operator-installed TypeScript extensions;
- explicit capability manifest;
- first-party DNS, backup, relay and AI providers;
- extension UI slots limited to their product surface;
- no public marketplace;
- no claim of in-process sandboxing.

## 9. Mail-engine and license strategy

### 9.1 Navin code ownership

Navin must not derive its UI/control-plane implementation from copyleft/no-license references.

Allowed default dependency policy:

- prefer MIT, Apache-2.0, BSD and ISC;
- explicit review for MPL/LGPL/EPL/CDDL;
- reject unknown license;
- no AGPL/GPL source import into Navin;
- preserve required notices and attribution;
- generate SBOM from lockfiles and distributed images.

### 9.2 Engine independence

- Existing Stalwart remains a compatibility/reference adapter during development.
- Navin packages must not assume Stalwart-specific objects outside `engine-stalwart`.
- Build a generic IMAP/SMTP adapter and evaluate Mox as a permissive default candidate.
- Evaluate Apache James only if JMAP completeness justifies its heavier JVM footprint.
- Public distribution cannot claim “license-clean/default permissive engine” until a permissive adapter passes the same acceptance suite.

### 9.3 Reference workflow

For every cloned repository record:

```text
URL
commit
license file at that commit
what behavior was studied
whether any code was imported
attribution if imported
reviewer/date
```

No external checkout is vendored into this repository.

## 10. Authentication plan

V1 identity priorities:

1. local administrator works fully offline;
2. local mailbox user;
3. optional external OIDC provider;
4. optional Navin account binding;
5. provider credentials remain separate from Navin identity.

Web:

- `mail.*` and `admin.*` are separate relying parties;
- host-only Secure/HttpOnly/SameSite cookies;
- no `Domain=.company.com` privileged cookie;
- server-side session/BFF;
- CSRF protection;
- shorter Control session;
- step-up for tier-3 operations.

Desktop:

- OS keychain;
- separate Mail/Control scopes;
- backend authorization remains authoritative.

CLI:

- scoped token reference stored with OS permissions/keychain where available;
- stable context switching;
- token never printed in logs or JSON output.

## 11. CLI first surface

Minimum command tree:

```text
navin login|logout|whoami
navin context list|use|add|remove
navin setup start|show|resume|approve|apply|verify|rollback|evidence
navin status
navin doctor
navin user add|list|show|suspend|delete
navin alias add|list|delete
navin domain add|list|verify
navin dns check
navin delivery inspect
navin backup run|list|verify
navin restore plan|apply
navin migrate start|status|resume|cutover
navin ask
```

CLI guarantees:

- human output by default;
- `--json` for read/automation paths;
- stable error codes;
- colors never carry meaning alone;
- identical plan/action/job IDs to Control Web/Desktop;
- `--yes` cannot bypass tier-3 confirmation.

## 12. Acceptance environments

Three distinct environments:

1. **Unit:** fakes allowed; no product claims.
2. **Disposable integration:** real navind, SQLite and mail engine in isolated containers/VM.
3. **Release acceptance:** packaged Web/Desktop/CLI against disposable remote infrastructure.

Never point automated acceptance at production.

Evidence bundle per milestone:

- exact commit;
- lockfile/SBOM;
- commands and exit codes;
- changed files;
- API/job/action IDs;
- audit records;
- protocol transcript with secrets redacted;
- browser screenshots for UI states;
- packaged Desktop evidence where required;
- cleanup verification;
- known residual risks.

## 13. Parallel implementation ownership

After owner approval, use isolated Orca worktrees with one writer per scope.

### Wave A — foundation

| Worker | Exclusive ownership |
|---|---|
| A1 | root pnpm/TypeScript/tooling files |
| A2 | `packages/contracts/**` |
| A3 | `packages/design-system/**` |
| A4 | `docs/references/**`, license gates/SBOM tooling |
| A5 | disposable acceptance environment only |

Integration gate: Master reviews and merges foundation; contracts freeze at v1 for the next wave.

### Wave B — real setup spine

| Worker | Exclusive ownership |
|---|---|
| B1 | `apps/navind` kernel/store/events |
| B2 | action runner and script adapter package |
| B3 | `packages/auth/**` |
| B4 | `apps/cli/**` |
| B5 | `packages/control-ui/**` + `apps/control-web/**` |
| B6 | `apps/desktop/**` |
| B7 | `packages/engine-core/**` + first engine adapter |
| B8 | setup acceptance tests only |

Integration order:

```text
contracts
→ navind/store/events
→ action runner + engine adapter
→ CLI + Control Web
→ Desktop
→ end-to-end gate
```

### Wave C — Mail loop

| Worker | Exclusive ownership |
|---|---|
| C1 | Mail engine query/change contracts |
| C2 | `packages/mail-ui` list/thread |
| C3 | compose/draft/attachment module |
| C4 | `apps/mail-web` shell/auth/routing |
| C5 | HTML sanitization/rendering boundary |
| C6 | Mail integration/E2E tests |

No two workers edit the same package. Contract changes go through a separate integration decision rather than being edited opportunistically.

Worker terminals/worktrees remain retained for owner inspection. Cleanup requires explicit owner request.

## 14. Master integration rules

The Master/Chief of Staff owns:

- task decomposition;
- exclusive path assignment;
- source/reference boundaries;
- monitoring;
- review of every diff;
- dependency/license verification;
- integration order;
- running authoritative gates;
- rejecting unverifiable worker claims;
- final owner report.

Workers cannot declare production readiness.

If a task stalls:

1. preserve its worktree;
2. split the task into a smaller scope;
3. assign a new isolated worker only after ownership is clear;
4. do not run two writers against the same files;
5. integrate small proven slices immediately.

## 15. First implementation batch after approval

Start only these tasks:

1. Create root pnpm/TypeScript workspace.
2. Add contracts for setup session, block, action, job, evidence and errors.
3. Convert design tokens into generated CSS/TS with drift and contrast tests.
4. Start `navind` with SQLite migration, `/health` and SSE event stream.
5. Build one read-only `system.discover` action against the disposable environment.
6. Build CLI rendering for that action.
7. Build Control Web rendering for that action.
8. Package the same Control UI in Tauri Desktop.
9. Prove all three attach to one persisted session across daemon restart.
10. Only then add the mailbox + alias plan/apply/verify action.

This batch intentionally excludes:

- broad Gmail UI;
- AI assistant;
- extension marketplace;
- calendar;
- offline cache;
- public deployment;
- production VPS mutation.

Those are not abandoned; they follow after the shared execution spine is proven.

## 16. Owner approval requested

Approve or amend:

1. Start with the First implementation batch in section 15.
2. Use current Stalwart only as a compatibility/development adapter while the permissive-engine path is proven.
3. Use `docs/design/navin-tokens.json` as canonical token source after reconciliation.
4. Keep local administrator as a first-class account; Navin cloud remains optional.
5. One Desktop app with separate permission-gated Mail and Control modules.
6. Allow unit fakes but require real disposable infrastructure at every milestone gate.
7. Retain all Orca worker terminals/worktrees for inspection.

No product implementation begins until the owner approves this plan.

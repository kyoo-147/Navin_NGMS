# @navin/action-core

Durable action, job, event and evidence ledger for the Navin control plane.

One SQLite (WAL) database stores the control-plane state shared by every surface.
The package owns the action state machine, risk/approval enforcement, idempotency
and concurrency control, an append-only redacted event/evidence/audit log, SSE
replay, and the executor **ports** through which real infrastructure work happens.

## Guarantees

- **Full action state machine** — `discover → plan → diff → approve → apply → verify → result → rollback`,
  with an explicit transition table and stage/status consistency checks.
- **Tier 3 controls** — typed confirmation phrase bound to the action id, mandatory
  recent authentication (step-up), never bypassable by a `force`/`--yes` flag;
  Tier 2 requires explicit diff approval. Tier 3 actions cannot even be persisted
  without an approval id.
- **Idempotency** — stage/apply/create operations accept idempotency keys; a repeated
  key with the same body reuses the original resource, a different body raises
  `IDEMPOTENCY_CONFLICT`.
- **Concurrency** — writers are serialised with `BEGIN IMMEDIATE`; records carry a
  revision and updates use compare-and-swap so stale writes fail with `CONFLICT`.
- **Append-only, redacted evidence** — events, evidence and audit records can never be
  updated or deleted (database triggers), and credential-shaped fields are redacted
  before persistence. Evidence carries a sha256 digest over the redacted content.
- **SSE replay** — events have a durable monotonic `seq` used as the `Last-Event-ID`
  cursor; reconnect replays missed events from SQLite and then streams live without
  duplicates.
- **Executor ports only** — the ledger never mutates infrastructure. `ActionService`
  and `JobRunner` delegate exclusively to registered `ActionExecutorPort` /
  `JobHandlerPort` implementations.

## Layout

| Path | Purpose |
| --- | --- |
| `src/sqlite/` | WAL database wrapper and schema migrations (incl. append-only triggers) |
| `src/state-machine.ts` | Action status transitions and stage consistency |
| `src/policy/risk-policy.ts` | Risk tier → confirmation policy and Tier 3 phrase |
| `src/ledger/` | Action, approval, job, event, evidence, audit and idempotency stores |
| `src/executor/` | Executor/job-handler ports and the resolving registry |
| `src/action-service.ts` | Lifecycle orchestration and approval enforcement |
| `src/job-runner.ts` | Durable job execution and progress streaming |
| `src/sse/event-stream.ts` | SSE formatting, `Last-Event-ID` parsing and replay |
| `src/core.ts` | `ActionCore` facade that wires a database and services |

## Usage

```ts
import { ActionCore } from '@navin/action-core'

const core = ActionCore.open({ path: '/var/lib/navin/control.db' })

core.executors.registerExecutor(myEngineAdapter)

const { action } = core.actionService.stageAction({
  name: 'dns.update_dkim_selector',
  surface: 'control',
  riskTier: 2,
  parameters: { domainId: 'dom_example', selector: '202610a' },
  requestedBy: 'usr_admin',
})

await core.actionService.planAction(action.id)
const approval = core.actionService.requestApproval(action.id)
core.actionService.decideApproval(approval.id, { decidedBy: 'usr_admin', decision: 'approved' })
await core.actionService.applyAction(action.id)
```

## Testing

```bash
pnpm --filter @navin/action-core test
pnpm --filter @navin/action-core typecheck
```

The suite includes real SQLite WAL persistence, clean restart, and hard-crash
recovery tests (a child process writes committed and uncommitted transactions and
is terminated abruptly; the parent asserts durability and rollback).

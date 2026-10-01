# Navin acceptance harness (W05)

Cross-platform, dependency-free Node harness that runs a declared acceptance
manifest and produces a tamper-evident evidence bundle. It exists to make
acceptance claims **truthful**: it never synthesises a `PASS`, and it refuses to
let weak evidence stand in for strong evidence classes.

Ownership: `tests/acceptance/**` (this directory). The harness does not import
production code and does not touch the root workspace, `apps/`, `packages/`,
`compose.yaml` or the production `scripts/`.

## Requirements

- Node.js 22+ (uses `node --test`, `node:crypto`, `node:net`, `node:dns`).
- No `npm install` needed: zero runtime dependencies.

## Quick start

```bash
cd tests/acceptance

# Unit/self-tests for the harness itself (52 tests)
node --test "test/**/*.test.mjs"

# Prove the harness is green end to end (all PASS)
node bin/navin-acceptance.mjs run --manifest manifests/harness-selftest.manifest.json --out evidence

# Run the full Phase 1 acceptance matrix (currently BLOCKED, truthfully)
node bin/navin-acceptance.mjs run --manifest manifests/phase1.manifest.json --out evidence

# Re-verify a bundle against its SHA-256 index (exit 0 = intact)
node bin/navin-acceptance.mjs verify evidence/<run-id>
```

Statuses map to stable exit codes: `PASS=0`, `FAIL=1`, `BLOCKED=2`, `NOT_RUN=3`,
usage/config error `=4`.

## Layout

```
tests/acceptance/
  bin/navin-acceptance.mjs     CLI entrypoint
  src/status.mjs               PASS/FAIL/BLOCKED/NOT_RUN + aggregation
  src/classes.mjs              evidence-class ladder
  src/ids.mjs                  correlation ids and timestamps
  src/redaction.mjs            secret redaction engine
  src/hashes.mjs               SHA-256 helpers + index build/verify
  src/guard.mjs                production deny / allow guard
  src/receipts.mjs             command/protocol/browser/desktop/external receipts
  src/manifest.mjs             run-manifest schema, validation, ordering
  src/executors.mjs            executor registry + built-in executors
  src/runner.mjs               orchestration + fake-success guard
  src/bundle.mjs               evidence bundle writer/verifier
  src/test-support.mjs         test-only helpers
  manifests/                   acceptance manifests
  test/                        node:test self-tests
  evidence/                    generated, ignored index-verified bundles
```

## Status model

Only four statuses exist. Aggregation is fail-closed with precedence
`FAIL > BLOCKED > NOT_RUN > PASS`.

- `PASS` — an executor ran and returned `PASS` **with at least one receipt whose
  own SHA-256 verifies and whose evidence class satisfies the requirement**.
- `FAIL` — an executor ran and returned failure, returned no valid status,
  returned `PASS` without a receipt, or violated the evidence-class rule.
- `BLOCKED` — a required precondition is unmet: missing executor, blocked
  dependency, rejected/unknown target, unreachable disposable service, or a
  precondition error.
- `NOT_RUN` — disabled in the manifest, an optional executor is missing, or a
  dependency did not run.

## Evidence classes

Evidence classes follow the plan's separation (`NAVIN_PHASE1_COMPLETE_PRODUCT_PLAN.md` §16).
A check that produced class _provided_ may satisfy a requirement of class
_required_ only when `rank(provided) >= rank(required)`. Stronger environment
evidence can stand in for weaker; never the reverse.

| class            | rank | meaning                           |
| ---------------- | ---: | --------------------------------- |
| `unit`           |    1 | unit and contract tests           |
| `integration`    |    2 | local process integration         |
| `protocol`       |    3 | real mail-protocol integration    |
| `browser`        |    4 | browser E2E                       |
| `desktop`        |    5 | packaged Desktop proof            |
| `vm_operations`  |    6 | disposable VM/VPS operations      |
| `migration`      |    7 | migration evidence                |
| `backup_restore` |    8 | backup and restore evidence       |
| `external`       |    9 | external DNS and network evidence |
| `manual`         |   10 | manual owner acceptance           |

Consequently a green unit or browser test can never satisfy `desktop` or
`external`. The runner enforces this at runtime, and `self.classes` asserts it.

Generated bundles may contain environment metadata. Keep them outside Git and
move durable records to an approved private evidence store.

## Production deny / allow guard

- Deny list (absolute, always wins): `production.example.invalid`,
  `mail.production.example.invalid`, `webmail.production.example.invalid`,
  `owner@example.invalid`.
- Auto-allowed: loopback, reserved test namespaces (`.test`, `.invalid`,
  `.example`, `.localhost`, `.local`, `.internal`) and reserved documentation IPs.
- Everything else is **denied by default** unless explicitly `allow`-listed.
- `allowUnknown` can relax the default deny, but production deny entries are
  still rejected.
- Manifests are scanned at load time: any production endpoint anywhere in the
  manifest makes the run throw `ManifestError` before a single executor starts.

## Extending

Register an executor in `src/executors.mjs` (or inject one in tests) as
`{ name, evidenceClass, description, run(ctx) }`. `run` returns
`{ status, receipts, detail }`; throw `PreconditionError` to report `BLOCKED`.
An executor that claims `PASS` without a matching receipt is downgraded to
`FAIL` by the runner. See `docs/implementation/ACCEPTANCE_EVIDENCE_MODEL.md` for
the full model.

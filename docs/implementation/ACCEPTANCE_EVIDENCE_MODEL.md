# Acceptance Evidence Model

Status: **implemented (W05)**
Date: 2026-10-01
Owner: W05 — acceptance harness
Scope: `tests/acceptance/**` (harness) and this document.
Related: `docs/implementation/NAVIN_PHASE1_COMPLETE_PRODUCT_PLAN.md` §3, §14.1, §16;
`docs/implementation/NAVIN_BUILD_PLAN.md` §12.

This document defines how Navin records and verifies acceptance evidence. It is
the contract the W05 harness implements. A later worker may implement executors
against it; the rules here do not change without an explicit, additive revision.

## 1. Why the model exists

A completion claim is only as strong as the environment that produced it. A unit
test cannot prove a packaged Desktop application launches; a browser test cannot
prove public DNS is published; a device that never ran cannot prove a restore.
The model therefore:

1. separates evidence into classes that cannot be collapsed;
2. forbids weak evidence from satisfying strong requirements;
3. records raw, redacted, content-addressed artifacts;
4. never lets the harness invent a `PASS`.

## 2. Evidence classes

Ten classes are retained, matching the plan. Each has a strength rank. A check
that produced evidence of class `provided` may satisfy a requirement of class
`required` **only** when `rank(provided) >= rank(required)`. Stronger
environment evidence may stand in for weaker; never the reverse.

| class            | rank | representative proof                         |
| ---------------- | ---: | -------------------------------------------- |
| `unit`           |    1 | unit/contract tests, fakes allowed           |
| `integration`    |    2 | real local process integration               |
| `protocol`       |    3 | real mail-protocol dialogue (SMTP/IMAP/JMAP) |
| `browser`        |    4 | browser E2E against the real server          |
| `desktop`        |    5 | packaged Desktop artifact that launches      |
| `vm_operations`  |    6 | disposable VM/VPS operations                 |
| `migration`      |    7 | mailbox migration baseline/delta/reconcile   |
| `backup_restore` |    8 | encrypted backup + isolated restore drill    |
| `external`       |    9 | external DNS/DNS records/network evidence    |
| `manual`         |   10 | manual owner acceptance                      |

Invariants enforced in code:

- `canSatisfy("unit", "external") === false` and
  `canSatisfy("unit", "desktop") === false`.
- A `PASS` receipt whose class is weaker than the manifest entry's required class
  turns the entry into `FAIL` with an `insufficient evidence class` detail.
- `browser` never satisfies `desktop`; `protocol` never satisfies `external`.

Rejected alternatives: collapsing classes into one "all tests passed" result,
or trusting a build output as proof of a different environment.

## 3. Status model

Exactly four statuses exist. There is no `WARN` and no implicit success.

- `PASS` — an executor ran and returned `PASS` with at least one receipt that
  verifies (SHA-256) and whose class satisfies the requirement.
- `FAIL` — an executor ran and returned failure, returned no valid status, or a
  `PASS` claim failed the truthfulness checks below.
- `BLOCKED` — a required precondition is unmet (missing executor, blocked
  dependency, rejected target, unreachable disposable service, precondition
  error). `BLOCKED` is the honest result for "the environment this claim needs is
  not present".
- `NOT_RUN` — disabled, optional executor missing, or a dependency did not run.

Aggregation over a run is fail-closed with precedence
`FAIL > BLOCKED > NOT_RUN > PASS`. A run with any `FAIL` is `FAIL`; a run with no
`FAIL` but any `BLOCKED` is `BLOCKED`; a run with only `NOT_RUN` is `NOT_RUN`.

Exit codes: `PASS=0`, `FAIL=1`, `BLOCKED=2`, `NOT_RUN=3`, usage/config error `=4`.

## 4. Truthfulness invariants (never fake success)

The runner refuses to propagate an unearned `PASS`:

1. **Receipt required.** A `PASS` with zero receipts becomes `FAIL`
   (`PASS asserted without a receipt (fake-success guard)`).
2. **Receipt integrity.** Every receipt carries `receiptSha256`; a mismatch
   becomes `FAIL`.
3. **Receipt status agreement.** A receipt whose own status is not `PASS` while
   the entry claims `PASS` becomes `FAIL`.
4. **Evidence-class sufficiency.** See §2.
5. **No valid status.** A non-status return value becomes `FAIL`.
6. **Missing executor.** A required entry whose executor is not registered is
   `BLOCKED`; an optional one is `NOT_RUN`. Neither is ever `PASS`.
7. **Dependency gating.** A failed or blocked dependency blocks dependants
   instead of letting them run and report a misleading result.
8. **Guard gating.** A target that fails the production deny/allow guard is
   `BLOCKED` before any executor is invoked.

## 5. Run manifest

A manifest is a JSON document validated before execution:

```jsonc
{
  "manifestVersion": 1,
  "name": "navin-phase1-acceptance",
  "allow": ["127.0.0.1", "localhost"],
  "entries": [
    {
      "id": "mail.protocol.smtp-banner",
      "name": "Real SMTP banner and EHLO exchange",
      "evidenceClass": "protocol", // required strength for this claim
      "executor": "protocol.smtp-banner",
      "required": true, // false => missing executor is NOT_RUN
      "enabled": true, // false => NOT_RUN
      "target": "127.0.0.1", // validated by the guard
      "params": { "port": 1025 },
      "dependsOn": ["mail.transport.tcp"],
      "timeoutMs": 8000,
      "claim": "A real SMTP dialogue returns 220 banner and 250 EHLO.",
    },
  ],
}
```

Validation rejects: wrong `manifestVersion`, empty/duplicate ids, unknown
`evidenceClass`, missing `executor`, self or unknown dependencies, dependency
cycles, and — critically — any production endpoint appearing anywhere in the
manifest.

## 6. Receipts

Every executor emits receipts. A receipt is a redacted, content-addressed record
with a common envelope and a kind-specific payload.

Common envelope:

- `schemaVersion`, `receiptId`, `correlationId` (unique per entry),
  `createdAt`/`startedAt`/`finishedAt` (ISO-8601), `durationMs`;
- `kind` ∈ {`command`, `protocol`, `browser`, `desktop`, `external`};
- `evidenceClass`, `status`, `target`, `detail`;
- `redaction` — whether redaction applied and which rules matched;
- `payloadSha256` and `receiptSha256`.

Kind payloads:

| kind       | class       | key fields                                                                                                |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `command`  | integration | `argv`, `cwd`, `exitCode`, `signal`, redacted `stdout`/`stderr` and their SHA-256                         |
| `protocol` | protocol    | `protocol`, `transport`, `endpoint`, `connected`, `tls`, redacted `transcript` + SHA-256                  |
| `browser`  | browser     | `url`, `browser`, `driver`, `consoleErrors`, `network`, `screenshots`                                     |
| `desktop`  | desktop     | `packageType`, `artifactName`, `artifactPath`, `artifactSha256`, `platform`, `launched`, `launchExitCode` |
| `external` | external    | `domain`, `resolvers`, `records`, `ptr`, `tls`, `spf`, `dkim`, `dmarc`, `sources`                         |

## 7. SHA-256 evidence index

Each run writes a bundle under `<out>/<runId>/`:

```
manifest.json
run.json                 # run summary, per-entry status, inline receipts
receipts/NNN_<kind>_<receiptId>.json
index.json               # entries: {path, bytes, sha256}, plus indexSha256
index.sha256             # sha256 of index.json bytes
```

`index.indexSha256` is the SHA-256 of the canonical (key-sorted) entries array;
`index.sha256` is the SHA-256 of the `index.json` file. `verifyBundle` recomputes
both and every artifact hash. Any change to any file, or a rewritten index, is
detected. Timestamps and correlation ids give ordering and traceability; hashes
give integrity. Neither is trusted as proof on its own — the executor that
produced the receipt is.

## 8. Redaction

All captured text passes through the redactor before storage. Rules:

- PEM private-key blocks;
- `Authorization: Bearer|Basic|Token …` headers;
- JWT-shaped tokens;
- URL credentials (`scheme://user:pass@`);
- `password|token|secret|api_key|client_secret|…` assignments, including quoted
  JSON keys;
- registered literal secrets (values supplied at runtime);
- object keys matching sensitive names are replaced wholesale.

The redaction report records only rule names and counts, never the matched
secret. Receipts are additionally run through a defense-in-depth redaction pass
at seal time.

## 9. Production deny / allow guard

- Deny list is absolute and always wins: `production.example.invalid`,
  `mail.production.example.invalid`, `webmail.production.example.invalid`,
  `owner@example.invalid`.
- Auto-allowed: loopback, reserved test namespaces (`.test`, `.invalid`,
  `.example`, `.localhost`, `.local`, `.internal`, `.home.arpa`) and reserved
  documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- Everything else is denied by default.
- `allowUnknown` relaxes the default deny but never permits deny-listed
  endpoints; an explicit `allow` entry cannot permit a deny-listed endpoint
  either.
- `checkCommand`/`checkText` scan command lines and free text for deny tokens;
  manifests are scanned at load time.

This operationalises "production VPS endpoints must not appear in automated
acceptance configuration or network traces" and "no production host was
contacted".

## 10. Mapping to the plan

- §16 evidence classes → §2 of this document (ten classes, ranked).
- §16 "a green unit or browser test cannot claim packaged Desktop, external
  network, restoration or production readiness" → §2/§4 enforced at runtime.
- §14.1 W05 "acceptance harness skeleton … evidence bundle and protocol
  capture" → the harness, receipts and bundle in `tests/acceptance/`.
- G8 "no production host was contacted … evidence collected" → guard (§9),
  manifests and bundles (§7).

## 11. Known limits (explicitly not claimed)

- The harness proves _its own_ truthfulness and provides real command/TCP/SMTP/
  IMAP capture. It does **not** claim product readiness: `phase1.manifest.json`
  currently reports `BLOCKED`/`NOT_RUN` until product code, disposable
  infrastructure and packaged artifacts exist.
- `browser`, `desktop`, `external` executors require configured drivers,
  artifacts and authorized external resources. Absent those, they report
  `BLOCKED`; they never fall back to a weaker claim.
- Evidence bundles are point-in-time artifacts. Re-run to refresh; the SHA-256
  index makes each run independently verifiable.

# Navin Reference Repositories Register

This directory contains structured provenance records for all external repositories studied during the design and engineering of the Navin next-generation mail server platform.

## Policy Enforcement

As defined in [`config/licenses/POLICY.md`](../../config/licenses/POLICY.md):
- **Reference-Only**: External repositories are studied strictly for protocol flows, architectural patterns, RFC interpretation, security defenses, and UX behaviors.
- **Zero Ingestion**: Under no circumstance is code from these references copied, pasted, transliterated, vendored, or adapted into Navin (`code_imported: false`).
- **Clean Separation**: External engines (such as Stalwart or Mox) operate solely behind isolated protocol adapters (`MailEngineAdapter`).
- **Automated Validation**: All records in this directory are validated by `scripts/check-licenses.mjs`.

---

## Studied Reference Registry

| ID | Project | Category | Observed License | Verified Commit | Primary Research Focus |
|---|---|---|---|---|---|
| [`stalwart`](./stalwart.json) | Stalwart Mail Server | external-engine | `AGPL-3.0-only OR LicenseRef-SEL` | `648df2d6` | JMAP/admin behavior, directory sync, storage engine |
| [`james`](./james.json) | Apache James | architecture-reference | `Apache-2.0` | `9aac8590` | Mailet pipeline architecture, JMAP RFC-8621, spool queue |
| [`mox`](./mox.json) | Mox Mail Server | architecture-reference | `MIT AND MPL-2.0` | `be2b6653` | DNS/ACME, deliverability, DKIM/DMARC/SPF, modern single-binary mail |
| [`mailu`](./mailu.json) | Mailu | architecture-reference | `MIT` | `e417c901` | Multi-container mail stack orchestration, web setup flows |
| [`mach`](./mach.json) | Mach Desktop Client | reference-only | `MIT` | `b5b07c46` | Tauri 2 IPC command boundaries, SQLite/FTS5, Gmail keyboard shortcuts |
| [`zero`](./zero.json) | Mail-0 (Zero) | reference-only | `MIT` | `64c5480c` | Compose hierarchy, thread view, AI drafting interaction ergonomics |
| [`stormbox`](./stormbox.json) | Thunderbird Stormbox | reference-only | `MPL-2.0` | `ccac91b5` | Sync state machines, offline mutation queueing, reactive stores |
| [`root-fr`](./root-fr.json) | root-fr jmap-webmail | reference-only | `MIT` | `fc7b22a7` | JMAP client lifecycle, mailbox hierarchy, draft compose |
| [`overture`](./overture.json) | Fastmail Overture | reference-only | `MIT` | `007aab21` | Observable state, undo/redo manager, query windows, sync design |
| [`jmap-js`](./jmap-js.json) | JMAP JS | standards-reference | `MIT` | `43627b4d` | IETF JMAP client protocol reference, batching, method invocation |
| [`thunderbird-android`](./thunderbird-android.json) | Thunderbird Android | reference-only | `Apache-2.0` | `df2d383d` | Sync state machines, durable outbox, IMAP IDLE & protocol quirks |
| [`proton-webclients`](./proton-webclients.json) | Proton Mail WebClients | reference-only | `GPL-3.0-only` | `4ceca26f` | Email sanitization pipeline, remote content blocking, security checklists |
| [`tauri-plugins`](./tauri-plugins.json) | Tauri Plugins Workspace | dependency-candidate | `MIT OR Apache-2.0` | `d4835d0e` | Deep links, updater, notifications, store, permissions ACL |
| [`warp`](./warp.json) | Warp Terminal | reference-only | `AGPL-3.0-only AND MIT` | `7cef787e` | Block-based terminal UI model, status indicators, operator UX |
| [`pi`](./pi.json) | Pi Coding Assistant | architecture-reference | `MIT` | `a0660b17` | Extension registration, agent session protocol, tool execution schemas |
| [`snappymail`](./snappymail.json) | SnappyMail Webmail | reference-only | `AGPL-3.0-only` | `c154d23c` | Legacy webmail container configuration parameters, migration baseline |

---

## Record Schema Requirements

Every record file `docs/references/<id>.json` conforms to the schema in [`config/licenses/schema.json`](../../config/licenses/schema.json) and requires:
1. `id`: Unique kebab-case slug matching file name.
2. `name`: Project display name.
3. `url`: Canonical git repository remote URL.
4. `pinned_commit`: Exact 40-character git commit SHA verified against local checkout cache.
5. `license`: Observed SPDX license expression or formal license identifier.
6. `license_files`: Array of license files located at that commit.
7. `category`: One of `reference-only`, `architecture-reference`, `standards-reference`, `dependency-candidate`, `external-engine`.
8. `role`: Specific role description in Navin's Phase 1 architecture plan.
9. `studied_paths`: Array of specific directories and source files examined.
10. `studied_behavior`: Narrative summary of the behavior, protocol, or mechanisms evaluated.
11. `code_imported`: Strictly `false`.
12. `attribution_required`: Boolean flag indicating if attribution is required if used as a dependency.
13. `caveats`: Specific risks, license boundaries, or runtime caveats.
14. `reviewer`: Reviewer identifier.
15. `verified_at`: Timestamp of local inspection.

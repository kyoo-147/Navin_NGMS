# Navin repository rules

These rules apply to every human or AI agent working in this repository.

## Repository content and privacy

This is a public, source-first repository. Git may contain:

- independently authored product source code;
- tests and deterministic test fixtures;
- generic configuration templates using reserved example values;
- product, architecture, implementation, security, and setup documentation needed to build or operate Navin;
- license, attribution, and source-provenance records.

Git must never contain deployment-specific or private operational material, including:

- real domains, hostnames, public or private server addresses, DNS zones, PTR values, DKIM records, provider account details, or production topology;
- real mailbox addresses, aliases, groups, forwarding destinations, user inventories, personal names used as deployment data, or message data;
- passwords, tokens, cookies, private keys, certificates, recovery material, credential bundles, or local SSH paths;
- `.env` files, databases, mail stores, backups, dumps, generated acceptance evidence, production logs, screenshots containing private data, or machine-specific configuration;
- dated production acceptance reports, incident records, private infrastructure notes, or generated research artifacts that are not required product/setup documentation.

Use only IANA-reserved examples in tracked files:

- domains such as `example.com`, `example.invalid`, and `company.test`;
- addresses under the documentation networks `192.0.2.0/24`, `198.51.100.0/24`, and `203.0.113.0/24`;
- generic users such as Alice, Bob, and Carol.

Store deployment configuration and evidence in ignored local paths or an approved private secrets/evidence system. Before every push, inspect the complete diff and scan tracked content for secrets, real domains, real IP addresses, mailbox identities, and machine-local paths. If sensitive material was pushed, stop publishing, rotate any credential that may be live, sanitize the tree, and purge reachable history rather than merely deleting the current file.

Generated acceptance bundles remain outside Git even when redacted. The repository contains the harness and schemas, not environment evidence.

## Work decomposition and workers

Parallel and sequential execution are both allowed. Independent work does not need to wait unnecessarily.

- Divide work into a small number of substantial, independently verifiable slices with balanced scope.
- Do not fragment one coherent change into many tiny tasks or create excessive workers; worker count must remain low enough that Orca and the workstation stay responsive.
- Prefer one owner per package or collision boundary and give each worker a complete outcome, acceptance criteria, and integration boundary.
- Run independent slices concurrently when that materially shortens delivery; integrate and verify continuously.
- Reuse retained workers for follow-up work when appropriate instead of spawning replacements.
- Keep worker terminals and worktrees for owner inspection. Do not delete, close, release, or clean them without explicit owner approval.
- Allowed fallback worker model: Pi `gpt-5.6-luna`, especially when another provider is quota-limited.
- The coordinating agent owns review, integration, repository hygiene, and executable verification; worker completion messages are not acceptance evidence.

## Product and implementation boundaries

- Preserve the approved Phase 1 plans under `docs/implementation/` and the design baseline under `docs/design/`.
- External repositories are reference-only unless a dependency is explicitly approved after license, maintenance, and security review.
- Do not copy external application source, branding, assets, or distinctive pixel-identical UI.
- Keep Mail, Control, CLI, daemon, engine adapter, and Desktop boundaries explicit.
- Never treat mocks, documentation, generated evidence, or an idle worker as proof that a milestone works.
- Do not run production mutation or automated acceptance against a live deployment from this repository.

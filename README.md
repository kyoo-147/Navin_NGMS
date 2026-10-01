<div align="center">

<img src="assets/ngms-logo.png" alt="NGMS — the next generation of mail infrastructure" width="520">

[![Homepage](https://img.shields.io/badge/Homepage-merak.navinresearch.com-111827?style=flat-square)](https://merak.navinresearch.com/)
[![Tech](https://img.shields.io/badge/Tech-merak.navinresearch.com%2Ftech-334155?style=flat-square)](https://merak.navinresearch.com/tech)
[![NGMS Blog](https://img.shields.io/badge/Blog-NGMS-475569?style=flat-square)](https://merak.navinresearch.com/blog/ngms)
[![License](https://img.shields.io/badge/License-PolyForm%20Noncommercial-64748b?style=flat-square)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Policy-64748b?style=flat-square)](SECURITY.md)
[![Contributing](https://img.shields.io/badge/Contributing-Guide-64748b?style=flat-square)](CONTRIBUTING.md)

<p><strong>The next generation of mail infrastructure</strong></p>

<p>From an empty server to secure, automated, AI-operated email in minutes.</p>

Source-available mail infrastructure for self-hosted and managed deployments.

[Get started](#quick-start) · [Architecture](#architecture) · [Roadmap](#project-status-and-roadmap) · [Contributing](#contributing)

</div>

NGMS is a source-available mail infrastructure platform for individuals, teams, businesses, developers, and AI agents. It is designed to bring deployment, domain setup, mail operations, migration, deliverability, backup, recovery, monitoring, automation, and controlled AI assistance into one coherent system.

NGMS can run on infrastructure you control or as a managed production deployment operated by Navin Research. In either model, the goal is the same: mail infrastructure that is understandable, portable, observable, and recoverable.

A deployment follows a clear operational lifecycle. NGMS helps the operator connect a target, describe the desired mail system, review the plan, apply the changes, verify the result, operate the installation, and recover it when necessary.

> **Project status:** this repository currently contains the production deployment foundation, operator tooling, cross-process contracts, design system, and acceptance work for NGMS. The complete multi-surface product is being built incrementally. Proposed capabilities are labelled as planned and are not presented as shipped functionality.

## What NGMS is

NGMS is not only a mail transport process or a webmail skin. It is an open control plane for the complete lifecycle of mail infrastructure:

- deploy a mail system on a new target;
- connect domains and configure required mail records;
- create mailboxes, aliases, groups, and shared addresses;
- operate mail through standard protocols and user-facing clients;
- migrate existing mail with baseline, delta, reconciliation, and cutover steps;
- inspect security, delivery, queues, certificates, and infrastructure health;
- create comprehensive backups and prove restoration;
- diagnose incidents with evidence instead of guesses;
- automate approved operations through APIs, jobs, events, and extensions;
- give AI assistants and agents scoped access to mail operations without bypassing authorization.

NGMS keeps ordinary mail work separate from infrastructure control. Users get a familiar Mail experience; operators get Control; automation gets a typed API and CLI. All surfaces use the same authoritative state and safety rules.

## Why NGMS

Mail infrastructure is difficult not because sending one message is difficult, but because a dependable system must keep many boundaries correct at once:

- identity and permissions;
- DNS and domain ownership;
- SMTP, IMAP, and modern mail APIs;
- TLS and sender authentication;
- storage, metadata, attachments, and recovery;
- migration without silent loss;
- deliverability and operational diagnosis;
- safe automation and human approval.

NGMS is built around explicit plans, diffs, approvals, verification, audit records, and rollback boundaries. AI can explain and propose; deterministic operations remain available when AI is disabled.

## Run NGMS your way

### Self-hosted

Run NGMS on infrastructure you control:

- VPS or dedicated server;
- bare metal or private cloud;
- public cloud or homelab;
- containerized environments;
- later, additional deployment targets through adapters.

Your domain, infrastructure, data, credentials, and recovery policy remain under your control. Self-hosted operation does not require a hosted account or a mandatory AI provider.

### Managed NGMS

A managed production deployment can operate the underlying infrastructure for users who want the NGMS experience without running the mail host themselves.

The managed edition uses the same product concepts and operational contracts as self-hosted NGMS. The deployment boundary changes; the Mail, Control, identity, policy, audit, and recovery model does not.

### Reference deployment

The repository includes a working reference deployment foundation for a single-host mail system:

- Docker Compose service lifecycle;
- pinned service images;
- local-only internal HTTP bindings behind a reverse proxy;
- standard SMTP submission and IMAP access;
- webmail integration;
- DNS and TLS diagnostics;
- mailbox, alias, and shared-address reconciliation;
- backup, checksum verification, restore, and post-restore checks;
- repeatable operator commands.

The reference deployment is an implementation path, not the product's permanent architecture. Mail engines, web clients, storage, DNS, TLS, backup, and AI integrations are adapter boundaries.

## Core capabilities

The following map describes the product target. Items marked **available** are present in the current repository or reference deployment. Items marked **planned** are product direction and require future implementation and acceptance.

### Deployment and setup

- **Available:** guided host checks, pinned Compose services, bootstrap, reconciliation, status, and diagnostics.
- **Planned:** shared setup sessions across Web, Desktop, and CLI;
- **Planned:** AI-assisted setup with a deterministic no-AI path;
- **Planned:** local-machine, remote-target, existing-instance, and restore flows;
- **Planned:** resource discovery, architecture preview, exact diffs, approvals, resumable jobs, and evidence bundles.

### Mail infrastructure

- **Available:** reference deployment with SMTP, authenticated submission, IMAP access, webmail, mailboxes, aliases, and shared-address routing.
- **Planned:** first-class JMAP integration and a normalized mail model;
- **Planned:** multiple domains, organization policies, quotas, delegated access, and richer protocol capability negotiation;
- **Planned:** replaceable mail-engine adapters without leaking engine-specific objects into public contracts.

### DNS, TLS, and deliverability

- **Available:** DNS guidance and verification, SPF/DKIM/DMARC checks, TLS checks, reverse-DNS checks, certificate synchronization, and anti-relay diagnostics.
- **Planned:** provider-neutral DNS adapters, automatic record planning, transport-policy checks, deliverability history, and evidence-backed remediation workflows.
- **Boundary:** correct DNS and authentication improve deliverability but cannot guarantee inbox placement by a receiving network.

### Security and governance

- **Available:** authenticated submission, sender-identity restrictions, restricted service bindings, secret exclusion, container hardening defaults, and operational diagnostics.
- **Planned:** scoped identities, step-up authentication, risk-tiered actions, approval ledgers, append-only audit, policy packs, rate controls, and extension permissions.
- **Planned:** optional integrations for malware and phishing analysis; these are not assumed to exist in every deployment.

### Migration and portability

- **Planned:** generic IMAP migration with discovery, mapping, baseline copy, delta synchronization, reconciliation, approved cutover, pause/resume, and rollback guidance.
- **Planned:** export of messages, attachments, metadata, and configuration into documented, portable formats.
- **Principle:** raw mail and operational state must remain recoverable without depending on one vendor-specific interface.

### Backup and recovery

- **Available:** consistent local backup, checksum verification, unsafe-path rejection, restore, rollback handling, and post-restore service/mailbox checks in the reference deployment.
- **Planned:** encrypted archives, remote backup targets, retention policy, restore plans, isolated restore drills, point-in-time recovery, and recovery evidence.
- **Rule:** creating an archive is not proof of backup. NGMS treats demonstrated restoration as the acceptance boundary.

### Monitoring and operations

- **Available:** service status, logs, host/listener checks, DNS/TLS diagnostics, readiness reporting, and operational scripts.
- **Planned:** persisted jobs and events, queue visibility, certificate and backup health, incident timelines, notification adapters, and continuous regression checks.

### Automation and extensions

- **Available:** repeatable shell operations and a provenance/license gate for the current repository.
- **Planned:** typed REST/SSE API, webhooks, schedules, idempotent actions, API clients, and trusted operator-installed extensions.
- **Planned extension points:** mail engines, deployment targets, DNS, TLS, storage, backup targets, migration connectors, identity, notifications, UI slots, and AI providers.

### AI and agent-native operations

- **Planned:** optional AI provider registry with managed, API-key, local-model, and no-AI modes;
- **Planned:** Mail Assistant and Control Operator with separate sessions and tool catalogs;
- **Planned:** log and deliverability explanation, configuration generation, migration guidance, incident analysis, and approved remediation;
- **Planned:** agent mailboxes, MCP/API access, scoped permissions, approval gates, and agent activity audit.

AI is a capability, not a visual theme and not a prerequisite for operating mail. Mail content must never gain Control authority merely because an AI system can read it.

## Architecture

NGMS is designed as a small control plane over replaceable operational adapters. People, applications, and agents interact through the Mail experience, Control experience, or CLI. These surfaces connect to the NGMS daemon, which owns identity, contracts, policy, persisted state, jobs, actions, audit, evidence, events, and the API.

The daemon coordinates mail access and setup/action workflows through typed adapter boundaries. Adapters connect NGMS to mail services, deployment targets, DNS, TLS, storage, backup, migration, and optional AI capabilities. The underlying infrastructure remains the operator's chosen target rather than being hard-coded into the product model.

### Architectural principles

- **Engine independence:** a mail engine is an adapter, not the public product model.
- **One authoritative state:** Web, Desktop, CLI, jobs, and events reconcile from the daemon's persisted state.
- **Separate authority:** Mail and Control have separate scopes, sessions, tool catalogs, and failure boundaries.
- **Evidence before claims:** readiness and completion require executable evidence.
- **Safe mutation:** high-risk actions expose plan, diff, approval, apply, verify, and rollback stages.
- **No-AI completeness:** deterministic setup and operations remain fully usable without AI.
- **Trusted extensions first:** installed extensions are powerful code; permissions document and gate product actions but do not pretend to sandbox arbitrary runtime code.
- **Small core:** the daemon owns lifecycle, contracts, identity, policy, jobs, audit, recovery, and extension loading; product capabilities live behind typed boundaries.

## Quick start

### Try the current reference deployment

This path runs the current repository deployment foundation on a Linux host. It is suitable for a controlled test or an approved production target.

```bash
cp .env.example .env
$EDITOR .env

sudo ./navin-mail install
sudo ./navin-mail bootstrap
./navin-mail status
./navin-mail doctor
./navin-mail dns
```

Configure your own domain, hostnames, public address, administrator address, timezone, image pins, and backup policy. Do not copy someone else's secrets or production values into `.env`.

Before directing live mail traffic to a deployment, verify DNS, reverse DNS, TLS, mailbox authentication, authenticated submission, anti-relay behavior, recipient routing, inbound/outbound delivery, backup integrity, and restoration. See [`docs/DNS-CUTOVER.md`](docs/DNS-CUTOVER.md). Store environment-specific acceptance records outside Git in an approved private evidence system.

### Repository development checks

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run provenance:check
pnpm run build
```

These checks validate the repository. They do not by themselves prove a production mail deployment, external delivery, or disaster recovery.

## CLI reference

```text
./navin-mail install
./navin-mail bootstrap
./navin-mail status
./navin-mail doctor
./navin-mail dns
./navin-mail logs [service]
./navin-mail nginx check|apply
./navin-mail configure-server
./navin-mail configure-snappymail
./navin-mail sync-certificate
./navin-mail user ...
./navin-mail backup
./navin-mail install-backup-timer
./navin-mail restore <archive>
./navin-mail update
```

The current command set operates the reference deployment. The future NGMS CLI will expose the same lifecycle through the shared Control-plane contracts rather than permanently coupling users to one service layout.

## Configuration and secrets

Use `.env.example` as a template:

```dotenv
DOMAIN=example.com
MAIL_HOSTNAME=mail.example.com
WEBMAIL_HOSTNAME=webmail.example.com
ADMIN_EMAIL=admin@example.com
SERVER_IPV4=203.0.113.10
TIMEZONE=UTC
```

The values above are placeholders. Each installation defines its own domain, hostnames, server addresses, image versions, storage, and backup targets.

Never commit environment files, API tokens, mailbox passwords, private keys, administrative credential bundles, mail data, or backups. Keep secrets root-only where appropriate, transfer initial credentials through a separate secure channel, and rotate them after first login.

## Project status and roadmap

### Available today

- Reference single-host deployment scripts and Compose configuration.
- Mail service bootstrap, reconciliation, status, doctor, DNS guidance, certificate synchronization, and logs.
- Generic mailbox administration, backup, restore, and update workflows in the reference deployment.
- Production-oriented contracts package for identities, sessions, setup blocks, actions, jobs, events, audit/evidence, normalized mail, engine descriptors, AI manifests, and extension manifests.
- Design baseline for separate Mail, Control, Desktop, and CLI surfaces.
- Repository provenance checks, tests, TypeScript build, lint, and formatting gates.

### In progress or planned

- `navind` daemon and shared persisted state;
- Web and Desktop Mail surfaces;
- Control Web, Control Desktop, and the thin NGMS CLI;
- real mail gateway and engine adapters behind normalized contracts;
- migration, encrypted offsite backup, isolated restore drills, and recovery evidence;
- optional AI providers, Mail Assistant, Control Operator, and agent-native interfaces;
- trusted extension loading and first-party capability packages;
- broader disposable acceptance across fresh targets without contacting live production.

The implementation plan is [`docs/implementation/NAVIN_PHASE1_COMPLETE_PRODUCT_PLAN.md`](docs/implementation/NAVIN_PHASE1_COMPLETE_PRODUCT_PLAN.md). It is an execution plan, not evidence that every listed capability already ships.

## Repository layout

```text
.
├── navin-mail                 # current reference deployment CLI
├── scripts/                   # deployment, diagnostics, backup, recovery, and reconciliation
├── compose.yaml               # current reference service topology
├── compose.acceptance.yaml    # disposable acceptance configuration
├── packages/contracts/        # shared cross-process and cross-worker contracts
├── docs/design/               # Mail, Control, Desktop, and design-system decisions
├── docs/implementation/       # implementation plans and acceptance boundaries
├── docs/references/           # reference and provenance records
├── tests/acceptance/          # disposable acceptance harness (generated evidence is ignored)
├── .env.example               # placeholder configuration template
└── package.json               # workspace checks and tooling
```

## Documentation map

- [`docs/design/`](docs/design/) — product surfaces, components, and UI rules.
- [`docs/implementation/`](docs/implementation/) — implementation sequencing and end-to-end acceptance contract.
- [`docs/USER-OPERATIONS-GUIDE.md`](docs/USER-OPERATIONS-GUIDE.md) — generic operations guidance.
- [`docs/DNS-CUTOVER.md`](docs/DNS-CUTOVER.md) — generic DNS cutover procedure.

## Contributing

Contributions should preserve the product boundaries and evidence standard:

1. Keep product code independently authored and record external research or dependencies through the repository provenance process.
2. Keep Mail, Control, CLI, daemon, and adapter boundaries explicit.
3. Do not expose engine-specific payloads through public contracts.
4. Keep AI optional and make permissions, approval, audit, and rollback explicit for mutations.
5. Add executable tests for behavior claims; store generated environment evidence outside Git.
6. Never point automated acceptance at a live production environment.
7. Run the repository checks before opening a change:

   ```bash
   pnpm install --frozen-lockfile
   pnpm run format:check
   pnpm run lint
   pnpm run typecheck
   pnpm run test
   pnpm run provenance:check
   pnpm run build
   ```

## License

NGMS is distributed under the [`PolyForm Noncommercial License 1.0.0`](LICENSE). The source is available for personal use, research, experimentation, testing, hobby projects, and other permitted noncommercial purposes. You may inspect, modify, and redistribute covered source under the license terms.

Commercial use, commercial redistribution, commercial hosting, and commercial services based on NGMS are not permitted under the default license. Commercial use requires a separate written commercial license from the rights holder.

Because the default license restricts commercial use, NGMS is **source-available**, not OSI-defined Open Source. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution terms and [`SECURITY.md`](SECURITY.md) for private vulnerability reporting.

The project is designed to support self-hosting and managed operation without locking the underlying mail data or product contracts to one deployment provider.

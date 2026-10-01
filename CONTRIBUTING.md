# Contributing to NGMS

Thank you for your interest in NGMS.

NGMS is a source-available mail infrastructure project. Contributions are welcome for noncommercial development, research, testing, documentation, and community improvement, subject to the license in [`LICENSE`](LICENSE).

## Before you start

- Read the [README](README.md) to understand the product boundaries and current project status.
- Read [`config/licenses/POLICY.md`](config/licenses/POLICY.md) before adding dependencies or studying external repositories.
- Check existing issues and pull requests before starting significant work.
- For substantial changes, open an issue or discussion first so the intended scope can be agreed.

## Development principles

- Keep Mail, Control, CLI, daemon, and adapter boundaries explicit.
- Preserve the replaceable mail-engine boundary; do not leak engine-specific objects into public contracts.
- Keep AI optional. Core mail and operations must remain usable without AI.
- Treat credentials, message content, attachments, metadata, and backups as sensitive.
- Use plan, diff, approval, apply, verify, and rollback stages for high-risk mutations.
- Do not point automated tests or acceptance runs at a live production environment.
- Do not copy, vendor, translate, or adapt source code from external applications. Record reference research in `docs/references/`.
- Keep claims in documentation aligned with executable evidence. Mark proposed and planned behavior clearly.

## Local setup

Requirements:

- Node.js 22 or newer;
- pnpm 10 or newer;
- Docker and Docker Compose for deployment or integration work;
- Bash-compatible shell for the deployment scripts.

Install dependencies and run the repository checks:

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run provenance:check
pnpm run build
```

Run focused package checks when appropriate. Never use real production credentials, domains, mailboxes, or servers in tests.

## Pull requests

A good pull request should:

1. explain the user or operator outcome;
2. describe scope and exclusions;
3. identify affected contracts, packages, scripts, and documentation;
4. include tests or executable validation evidence;
5. call out security, migration, recovery, or compatibility risks;
6. update documentation when behavior or support boundaries change;
7. keep unrelated formatting and dependency changes out of the diff.

For changes to public contracts, include compatibility and migration notes. For destructive or operational changes, include the risk tier, approval behavior, rollback path, and verification evidence.

## Licensing contributions

By submitting a contribution, you represent that you have the right to submit it and that it may be distributed under the repository's [`PolyForm Noncommercial License 1.0.0`](LICENSE). Do not submit code copied from a project whose license or provenance has not been reviewed.

NGMS does not currently accept contributions under additional licenses or with terms that conflict with the repository license. Commercial use, commercial redistribution, commercial hosting, and commercial services based on NGMS require a separate written commercial license from the rights holder.

## Conduct

Be respectful, specific, and constructive. Do not disclose secrets, private mail, personal data, exploit details, or production infrastructure information in public issues or pull requests.

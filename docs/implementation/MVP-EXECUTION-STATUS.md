# Merak MVP execution status

Status: `IN_PROGRESS` handoff checkpoint. This file records the repository state at the machine handoff; it is not an MVP completion claim.

## Repository

- Repository: `kyoo-147/Navin_NGMS`
- Integration branch: `main`
- Baseline: `8eaf139 docs(governance): adopt Merak product ownership policy`
- Remote: `origin`
- No production deployment or production mutation was performed.

## Worker branches

| Worker | Branch | Worktree | State |
| --- | --- | --- | --- |
| PRD, repository and workflow | `feat/merak-mvp-prd` | `D:/work/projects/.worktrees/merak-mvp-prd` | PRD and handoff checkpoint prepared |
| Design system and frontend | `feat/merak-mvp-frontend` | `D:/work/projects/.worktrees/merak-mvp-frontend` | Audit complete; no product files changed |
| Backend, mail core and infrastructure | `feat/merak-mvp-backend` | `D:/work/projects/.worktrees/merak-mvp-backend` | Audit complete; no product files changed |

Each worker has a separate Herdr tab in workspace `w3`.

## Verified work

- `docs/PRD.md` consolidates approved MVP scope, non-goals, authority boundaries, API v1 expectations, data ownership, acceptance gates and Definition of Done.
- Frontend audit found an existing Control setup command seam mismatch, incomplete stage navigation, token adoption gaps, Desktop composition placeholders and a browser authentication contract mismatch to resolve before implementation.
- Backend audit found existing navind auth, Control and Mail route boundaries, normalized mail gateway, durable MailStore and recovery-core seams. Durable MailStore integration into the navind runtime and recovery lifecycle mapping remain implementation work.
- Repository baseline checks were run. Lint, tests, typecheck and build completed in the PRD worktree. Provenance tests remain blocked by missing local reference checkouts/cache entries on this machine, including the expected Stalwart checkout.

## Next machine handoff

1. Fetch `origin` and check out the pushed `feat/merak-mvp-prd` branch.
2. Review and merge or continue the PRD branch through the normal pull-request workflow.
3. Reconcile the API/data contract with the frontend and backend audits before authorizing product implementation.
4. Keep `feat/merak-mvp-frontend` and `feat/merak-mvp-backend` as audit branches until implementation ownership is explicitly assigned.
5. Treat the approved product documentation and interactive prototypes under `D:/work/projects/merak-product-docs` as local source material; that directory is not a Git repository and was not converted into a new repository.

## Non-claims

This checkpoint does not prove that the MVP is implemented, that Web or Mobile connects to a live backend, that authentication is production-ready, that real mail delivery works, that backup/restore is verified, or that deployment evidence exists.

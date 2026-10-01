# Navin Provenance and Dependency License Policy

## 1. Overview & Core Principles

Navin is an independent, next-generation mail server platform. All application, control plane, and daemon logic in Navin is authored natively.

To safeguard code provenance, prevent intellectual property contamination, and maintain strict license compliance:

1. **No External App Code Ingestion**: External repositories are studied strictly as **reference materials** (protocols, RFCs, state machines, operational edge cases, UI ergonomics). Code from external applications must never be copied, pasted, transliterated, vendored, or adapted into Navin.
2. **Mandatory Reference Records**: Every reference repository analyzed during development must be registered in `docs/references/` with a verified commit SHA, observed license, exact studied paths, behavior description, caveats, and `code_imported: false`.
3. **Reference vs. Dependency Distinction**:
   - **Reference-Only**: External repositories inspected for architectural understanding, protocol semantics, or behavior. They never enter the dependency graph, binary bundle, or source tree.
   - **Third-Party Dependency**: Declared runtime or build dependencies pulled through package managers (`npm`/`pnpm`, `cargo`). These must pass strict license allowlist review.
4. **Prohibition of Copyleft App-Source Derivation**: Navin must not derive its UI, daemon, or control-plane implementation from copyleft (GPL, AGPL) or unlicensed references.

---

## 2. Dependency License Allowlist

All runtime and distribution dependencies in `package.json` or `Cargo.toml` must adhere to this classification:

### Permissive (Allowed without special exception)
- `MIT`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `ISC`

### Review Required (Weak copyleft / file-level copyleft)
Dependencies under these licenses require explicit architectural review to ensure they are consumed as clean modular libraries without imposing copyleft obligations on Navin:
- `MPL-2.0` (Mozilla Public License 2.0)
- `LGPL-3.0-only` / `LGPL-2.1-only` (dynamic linking only; no static derivation)
- `CDDL-1.0`

### Prohibited (Strictly forbidden in Navin code and dependencies)
- `AGPL-3.0-only` / `AGPL-3.0-or-later`
- `GPL-2.0-only` / `GPL-2.0-or-later`
- `GPL-3.0-only` / `GPL-3.0-or-later`
- `SSPL-1.0`
- `BUSL-1.1`
- `UNLICENSED` / `UNKNOWN` / Missing license

---

## 3. Application Source Import Policy

- **Zero Vendoring**: No external application repository may be vendored or embedded into `apps/`, `packages/`, or `src/`.
- **`code_imported: false` Enforcement**: Every reference record must have `"code_imported": false`. If any code is ever imported from an allowed permissive library, it requires an approved dependency RFC and explicit attribution.
- **Independent Clean-Room Architecture**:
  - Behavior baselines (e.g. Gmail keyboard shortcuts, search syntax, thread interaction) inform UX requirements, not implementation code.
  - Protocol specifications (e.g. RFC 8620, RFC 8621 for JMAP; RFC 5321 for SMTP; RFC 3501/9051 for IMAP) are implemented independently against open specifications.
  - External engines (e.g. Stalwart, Mox, Apache James) operate exclusively behind isolated adapter interfaces (`MailEngineAdapter`).

---

## 4. Reference Provenance Records

All references in `docs/references/*.json` must include the following schema fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique kebab-case identifier (e.g., `stalwart`, `james`, `mox`) |
| `name` | string | Human-readable name of the reference project |
| `url` | string | Upstream repository URL |
| `pinned_commit` | string | Verified 40-character hexadecimal git commit SHA |
| `license` | string | Observed SPDX license identifier or license description |
| `license_files` | string[] | Array of license file paths at the pinned commit |
| `category` | enum | `reference-only`, `architecture-reference`, `standards-reference`, `dependency-candidate`, or `external-engine` |
| `role` | string | Explicit role played in Navin's architecture / research |
| `studied_paths` | string[] | Exact directories and source paths inspected |
| `studied_behavior` | string | Description of studied behaviors, protocols, or edge cases |
| `code_imported` | boolean | Must be `false` |
| `attribution_required` | boolean | Whether attribution is required if used as dependency |
| `caveats` | string[] | Specific risks, license constraints, and non-goals |
| `reviewer` | string | Reviewer handle/identifier |
| `verified_at` | string | ISO date or timestamp of local verification |

---

## 5. Automated Verification

The automated checker script `scripts/check-licenses.mjs` enforces this policy by:
- Scanning `docs/references/*.json` against the schema.
- Verifying all required fields are present and well-formed.
- Ensuring `code_imported` is strictly `false`.
- Verifying licenses are known and not unknown/unlicensed.
- Confirming commit SHAs are 40-character hex strings.
- Exiting with code `1` and failing CI if any violation is detected.

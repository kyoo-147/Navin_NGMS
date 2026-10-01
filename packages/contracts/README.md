# @navin/contracts

Production-grade TypeBox schemas and TypeScript contracts for the Navin platform.

## Overview

`@navin/contracts` defines the frozen cross-process and cross-worker boundary contracts for Navin Phase 1:

- **Common & Envelope**: Branded IDs (`AccountId`, `UserId`, `DomainId`, `ActionId`, `SetupSessionId`, etc.), version envelopes (`VersionEnvelope`), surface identities (`mail`, `control`, `cli`), and standardized `NavinError` envelopes.
- **Auth & Session**: Relying parties (`navin-mail`, `navin-control`), scoped roles, session assurance levels (`standard`, `mfa_verified`, `step_up_recent`), and host-only cookie policies (`__Host-` prefix).
- **Setup & Lifecycle**: The 20 setup stages, semantic `SetupBlock` kinds, statuses, `SetupSession`, and real-time SSE reconnect events.
- **Action Lifecycle & Risk**: Canonical 8-stage action lifecycle (`discover → plan → diff → approve → apply → verify → result → rollback`), risk tiers 0 through 3, structured diffs, and Tier 3 approval requirements.
- **Jobs & Background Events**: Resumable, idempotent background jobs, granular progress reporting, and event channel topics.
- **Audit & Evidence**: Structured audit records (strictly redacting message content and secrets) and cryptographically verifiable evidence records with sha256 digests.
- **Normalized Mail**: Query filters, windowed queries, mutations with idempotency and undo tokens, and RFC-compliant mail submissions.
- **Engine Adapter Descriptors**: Capabilities and protocol support matrices (JMAP, IMAP, SMTP, Sieve, CalDAV, CardDAV) for Stalwart and future engines.
- **AI Provider Manifests**: Manifests for provider onboarding (`navin_managed`, `oauth`, `api_key`, `local_model`, `none`), data sharing policies, and surface-isolated tool catalogs (Mail Assistant vs. Control Operator).
- **Extension Manifests**: Operator-installed extension manifests, trust tiers, capability permissions, and surface-scoped UI contributions.
- **Validation Helpers**: High-performance cached TypeCompiler utilities (`validate`, `assertValid`, `isValid`, and `NavinContractValidationError`).

## Usage

```typescript
import {
  validate,
  assertValid,
  isValid,
  VersionEnvelopeSchema,
  SetupBlockSchema,
  MailSubmissionRequestSchema,
  type SetupBlock,
  type MailSubmissionRequest,
} from '@navin/contracts'

// Validation helper returning structured result:
const result = validate(SetupBlockSchema, data)
if (result.success) {
  const block: SetupBlock = result.data
} else {
  console.error('Validation errors:', result.errors)
}

// Assertion helper:
assertValid(MailSubmissionRequestSchema, payload)
```

## Testing & Typecheck

```bash
npm test
npm run typecheck
npm run build
```

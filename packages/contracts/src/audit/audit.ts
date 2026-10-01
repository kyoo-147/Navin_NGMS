import { Type, type Static } from '@sinclair/typebox'
import {
  AuditIdSchema,
  UserIdSchema,
  DomainIdSchema,
  MailboxIdSchema,
  ActionIdSchema,
  JobIdSchema,
  ApprovalIdSchema,
} from '../common/id.js'
import { NavinSurfaceSchema } from '../common/surface.js'
import { IsoTimestampSchema } from '../common/envelope.js'
import { NavinRoleSchema } from '../auth/scopes.js'
import { RiskTierSchema } from '../action/risk-approval.js'

export const AuditOutcomeSchema = Type.Union([
  Type.Literal('success'),
  Type.Literal('failure'),
  Type.Literal('denied'),
])
export type AuditOutcome = Static<typeof AuditOutcomeSchema>

export const AuditActorSchema = Type.Object(
  {
    userId: UserIdSchema,
    email: Type.Optional(Type.String()),
    role: NavinRoleSchema,
    surface: NavinSurfaceSchema,
    ipAddress: Type.Optional(Type.String()),
    userAgent: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type AuditActor = Static<typeof AuditActorSchema>

export const AuditTargetSchema = Type.Object(
  {
    resourceType: Type.String({ minLength: 1 }),
    domainId: Type.Optional(DomainIdSchema),
    userId: Type.Optional(UserIdSchema),
    mailboxId: Type.Optional(MailboxIdSchema),
    actionId: Type.Optional(ActionIdSchema),
    jobId: Type.Optional(JobIdSchema),
    identifier: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type AuditTarget = Static<typeof AuditTargetSchema>

/**
 * AuditRecord models the control-plane audit trail.
 * Sanitized to avoid raw message bodies and credential secrets by default.
 */
export const AuditRecordSchema = Type.Object(
  {
    id: AuditIdSchema,
    actor: AuditActorSchema,
    actionName: Type.String({ minLength: 1 }),
    target: AuditTargetSchema,
    outcome: AuditOutcomeSchema,
    riskTier: RiskTierSchema,
    approvalId: Type.Optional(ApprovalIdSchema),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    timestamp: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type AuditRecord = Static<typeof AuditRecordSchema>

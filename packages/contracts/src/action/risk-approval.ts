import { Type, type Static } from '@sinclair/typebox'
import { ApprovalIdSchema, ActionIdSchema, PlanIdSchema, UserIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'

export const RiskTierSchema = Type.Union([
  Type.Literal(0),
  Type.Literal(1),
  Type.Literal(2),
  Type.Literal(3),
])
export type RiskTier = Static<typeof RiskTierSchema>

export const ConfirmationTypeSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('simple'),
  Type.Literal('explicit_diff'),
  Type.Literal('typed_confirmation'),
])
export type ConfirmationType = Static<typeof ConfirmationTypeSchema>

export const ApprovalStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('expired'),
])
export type ApprovalStatus = Static<typeof ApprovalStatusSchema>

export const ApprovalDecisionChoiceSchema = Type.Union([
  Type.Literal('approved'),
  Type.Literal('rejected'),
])
export type ApprovalDecisionChoice = Static<typeof ApprovalDecisionChoiceSchema>

export const ApprovalDecisionSchema = Type.Object(
  {
    approvalId: ApprovalIdSchema,
    decidedBy: UserIdSchema,
    decision: ApprovalDecisionChoiceSchema,
    reason: Type.Optional(Type.String()),
    stepUpVerified: Type.Boolean(),
    decidedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>

export const StandardApprovalRequestSchema = Type.Object(
  {
    id: ApprovalIdSchema,
    actionId: ActionIdSchema,
    planId: PlanIdSchema,
    riskTier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    confirmationType: ConfirmationTypeSchema,
    typedPhrase: Type.Optional(Type.String({ minLength: 1 })),
    requiresRecentAuth: Type.Boolean(),
    requestedBy: UserIdSchema,
    status: ApprovalStatusSchema,
    decision: Type.Optional(ApprovalDecisionSchema),
    createdAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type StandardApprovalRequest = Static<typeof StandardApprovalRequestSchema>

export const Tier3ApprovalRequestSchema = Type.Object(
  {
    id: ApprovalIdSchema,
    actionId: ActionIdSchema,
    planId: PlanIdSchema,
    riskTier: Type.Literal(3),
    confirmationType: Type.Literal('typed_confirmation'),
    typedPhrase: Type.String({ minLength: 1 }),
    requiresRecentAuth: Type.Literal(true),
    requestedBy: UserIdSchema,
    status: ApprovalStatusSchema,
    decision: Type.Optional(ApprovalDecisionSchema),
    createdAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type Tier3ApprovalRequest = Static<typeof Tier3ApprovalRequestSchema>

export const ApprovalRequestSchema = Type.Union([
  StandardApprovalRequestSchema,
  Tier3ApprovalRequestSchema,
])
export type ApprovalRequest = Static<typeof ApprovalRequestSchema>

import { Type, type Static } from '@sinclair/typebox'
import { ActionIdSchema, UserIdSchema, ApprovalIdSchema } from '../common/id.js'
import { NavinSurfaceSchema } from '../common/surface.js'
import { IsoTimestampSchema } from '../common/envelope.js'
import { NavinErrorSchema } from '../common/error.js'

export const ActionLifecycleStageSchema = Type.Union([
  Type.Literal('discover'),
  Type.Literal('plan'),
  Type.Literal('diff'),
  Type.Literal('approve'),
  Type.Literal('apply'),
  Type.Literal('verify'),
  Type.Literal('result'),
  Type.Literal('rollback'),
])
export type ActionLifecycleStage = Static<typeof ActionLifecycleStageSchema>

export const ActionStatusSchema = Type.Union([
  Type.Literal('staged'),
  Type.Literal('planned'),
  Type.Literal('awaiting_approval'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('applying'),
  Type.Literal('verifying'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('rolling_back'),
  Type.Literal('rolled_back'),
  Type.Literal('rollback_failed'),
])
export type ActionStatus = Static<typeof ActionStatusSchema>

export const ActionDiffOpSchema = Type.Union([
  Type.Literal('add'),
  Type.Literal('replace'),
  Type.Literal('remove'),
])
export type ActionDiffOp = Static<typeof ActionDiffOpSchema>

export const ActionDiffChangeSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    op: ActionDiffOpSchema,
    oldValue: Type.Optional(Type.Unknown()),
    newValue: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
)
export type ActionDiffChange = Static<typeof ActionDiffChangeSchema>

export const ActionDiffSchema = Type.Object(
  {
    summary: Type.String(),
    changes: Type.Array(ActionDiffChangeSchema),
  },
  { additionalProperties: false },
)
export type ActionDiff = Static<typeof ActionDiffSchema>

export const ActionVerificationSchema = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    expected: Type.Unknown(),
    actual: Type.Optional(Type.Unknown()),
    passed: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)
export type ActionVerification = Static<typeof ActionVerificationSchema>

export const StandardActionExecutionSchema = Type.Object(
  {
    id: ActionIdSchema,
    name: Type.String({ minLength: 1, pattern: '^[a-z0-9_-]+\\.[a-z0-9_.-]+$' }),
    surface: NavinSurfaceSchema,
    stage: ActionLifecycleStageSchema,
    status: ActionStatusSchema,
    riskTier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    parameters: Type.Record(Type.String(), Type.Unknown()),
    diff: Type.Optional(ActionDiffSchema),
    verification: Type.Optional(ActionVerificationSchema),
    canRollback: Type.Boolean(),
    requestedBy: UserIdSchema,
    approvalId: Type.Optional(ApprovalIdSchema),
    error: Type.Optional(NavinErrorSchema),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type StandardActionExecution = Static<typeof StandardActionExecutionSchema>

export const Tier3ActionExecutionSchema = Type.Object(
  {
    id: ActionIdSchema,
    name: Type.String({ minLength: 1, pattern: '^[a-z0-9_-]+\\.[a-z0-9_.-]+$' }),
    surface: NavinSurfaceSchema,
    stage: ActionLifecycleStageSchema,
    status: ActionStatusSchema,
    riskTier: Type.Literal(3),
    parameters: Type.Record(Type.String(), Type.Unknown()),
    diff: Type.Optional(ActionDiffSchema),
    verification: Type.Optional(ActionVerificationSchema),
    canRollback: Type.Boolean(),
    requestedBy: UserIdSchema,
    approvalId: ApprovalIdSchema,
    error: Type.Optional(NavinErrorSchema),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type Tier3ActionExecution = Static<typeof Tier3ActionExecutionSchema>

export const ActionExecutionSchema = Type.Union([
  StandardActionExecutionSchema,
  Tier3ActionExecutionSchema,
])
export type ActionExecution = Static<typeof ActionExecutionSchema>

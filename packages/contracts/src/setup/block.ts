import { Type, type Static } from '@sinclair/typebox'
import { SetupBlockIdSchema, SetupSessionIdSchema, EvidenceIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'

export const SetupStageSchema = Type.Union([
  Type.Literal('WELCOME'),
  Type.Literal('IDENTITY'),
  Type.Literal('INTELLIGENCE'),
  Type.Literal('DEPLOYMENT_INTENT'),
  Type.Literal('CONNECT_TARGET'),
  Type.Literal('DISCOVER'),
  Type.Literal('REQUIREMENTS'),
  Type.Literal('CAPABILITIES'),
  Type.Literal('PLAN'),
  Type.Literal('APPROVAL'),
  Type.Literal('APPLY'),
  Type.Literal('VERIFY_INFRA'),
  Type.Literal('PROVISION'),
  Type.Literal('VERIFY_MAIL'),
  Type.Literal('MIGRATE'),
  Type.Literal('CUTOVER_APPROVAL'),
  Type.Literal('CUTOVER'),
  Type.Literal('BACKUP'),
  Type.Literal('RESTORE_DRILL'),
  Type.Literal('READY'),
])
export type SetupStage = Static<typeof SetupStageSchema>

export const SetupBlockKindSchema = Type.Union([
  Type.Literal('question'),
  Type.Literal('discovery'),
  Type.Literal('recommendation'),
  Type.Literal('plan'),
  Type.Literal('diff'),
  Type.Literal('approval'),
  Type.Literal('action'),
  Type.Literal('verification'),
  Type.Literal('evidence'),
  Type.Literal('warning'),
  Type.Literal('recovery'),
])
export type SetupBlockKind = Static<typeof SetupBlockKindSchema>

export const SetupBlockStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('ready'),
  Type.Literal('running'),
  Type.Literal('passed'),
  Type.Literal('warning'),
  Type.Literal('failed'),
  Type.Literal('blocked'),
  Type.Literal('skipped'),
  Type.Literal('retrying'),
  Type.Literal('rollback_running'),
  Type.Literal('rolled_back'),
  Type.Literal('rollback_failed'),
])
export type SetupBlockStatus = Static<typeof SetupBlockStatusSchema>

export const SetupBlockRiskSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('staged'),
  Type.Literal('mutable'),
  Type.Literal('shared'),
  Type.Literal('destructive'),
])
export type SetupBlockRisk = Static<typeof SetupBlockRiskSchema>

export const SetupBlockSchema = Type.Object(
  {
    id: SetupBlockIdSchema,
    sessionId: SetupSessionIdSchema,
    schemaVersion: Type.String({ minLength: 1 }),
    stage: SetupStageSchema,
    kind: SetupBlockKindSchema,
    status: SetupBlockStatusSchema,
    title: Type.String({ minLength: 1 }),
    summary: Type.String(),
    inputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    value: Type.Optional(Type.Unknown()),
    evidenceIds: Type.Optional(Type.Array(EvidenceIdSchema)),
    risk: Type.Optional(SetupBlockRiskSchema),
    canRetry: Type.Boolean(),
    canRollback: Type.Boolean(),
    dependencies: Type.Array(SetupBlockIdSchema),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type SetupBlock = Static<typeof SetupBlockSchema>

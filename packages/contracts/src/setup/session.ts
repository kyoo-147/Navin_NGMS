import { Type, type Static } from '@sinclair/typebox'
import { SetupSessionIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'
import { SetupStageSchema, SetupBlockSchema } from './block.js'

export const LocalTargetHostSchema = Type.Object(
  {
    kind: Type.Literal('local'),
    host: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
export type LocalTargetHost = Static<typeof LocalTargetHostSchema>

export const RemoteSshTargetHostSchema = Type.Object(
  {
    kind: Type.Literal('ssh_vps'),
    host: Type.String({ minLength: 1 }),
    fingerprint: Type.String({ minLength: 1, description: 'Pinned SSH host key fingerprint' }),
  },
  { additionalProperties: false },
)
export type RemoteSshTargetHost = Static<typeof RemoteSshTargetHostSchema>

export const RemoteDaemonTargetHostSchema = Type.Object(
  {
    kind: Type.Literal('remote_daemon'),
    host: Type.String({ minLength: 1 }),
    fingerprint: Type.String({
      minLength: 1,
      description: 'Pinned daemon certificate/TLS fingerprint',
    }),
  },
  { additionalProperties: false },
)
export type RemoteDaemonTargetHost = Static<typeof RemoteDaemonTargetHostSchema>

export const TargetHostDescriptorSchema = Type.Union([
  LocalTargetHostSchema,
  RemoteSshTargetHostSchema,
  RemoteDaemonTargetHostSchema,
])
export type TargetHostDescriptor = Static<typeof TargetHostDescriptorSchema>

export const IntelligenceModeSchema = Type.Union([
  Type.Literal('navin_managed'),
  Type.Literal('provider_byok'),
  Type.Literal('local_model'),
  Type.Literal('none'),
])
export type IntelligenceMode = Static<typeof IntelligenceModeSchema>

export const SetupSessionStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('abandoned'),
])
export type SetupSessionStatus = Static<typeof SetupSessionStatusSchema>

export const SetupSessionSchema = Type.Object(
  {
    id: SetupSessionIdSchema,
    title: Type.String({ minLength: 1 }),
    currentStage: SetupStageSchema,
    status: SetupSessionStatusSchema,
    intelligenceMode: IntelligenceModeSchema,
    targetHost: Type.Optional(TargetHostDescriptorSchema),
    blocks: Type.Array(SetupBlockSchema),
    eventCursor: Type.Optional(Type.String()),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type SetupSession = Static<typeof SetupSessionSchema>

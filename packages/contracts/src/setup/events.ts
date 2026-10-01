import { Type, type Static } from '@sinclair/typebox'
import { SetupSessionIdSchema, SetupBlockIdSchema } from '../common/id.js'
import { VersionEnvelopeSchema } from '../common/envelope.js'
import { SetupStageSchema, SetupBlockStatusSchema } from './block.js'

export const SetupEventPayloadSchema = Type.Object(
  {
    sessionId: SetupSessionIdSchema,
    blockId: Type.Optional(SetupBlockIdSchema),
    stage: Type.Optional(SetupStageSchema),
    previousStatus: Type.Optional(SetupBlockStatusSchema),
    newStatus: Type.Optional(SetupBlockStatusSchema),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)
export type SetupEventPayload = Static<typeof SetupEventPayloadSchema>

export const SetupEventSchema = VersionEnvelopeSchema(SetupEventPayloadSchema)
export type SetupEvent = Static<typeof SetupEventSchema>

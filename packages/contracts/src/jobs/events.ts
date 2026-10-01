import { Type, type Static } from '@sinclair/typebox'
import { JobIdSchema } from '../common/id.js'
import { VersionEnvelopeSchema } from '../common/envelope.js'
import { JobStatusSchema, JobProgressSchema } from './job.js'

export const EventChannelSchema = Type.Union([
  Type.Literal('jobs'),
  Type.Literal('setup'),
  Type.Literal('mail'),
  Type.Literal('audit'),
  Type.Literal('system'),
])
export type EventChannel = Static<typeof EventChannelSchema>

export const BackgroundEventPayloadSchema = Type.Object(
  {
    channel: EventChannelSchema,
    jobId: Type.Optional(JobIdSchema),
    status: Type.Optional(JobStatusSchema),
    progress: Type.Optional(JobProgressSchema),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
)
export type BackgroundEventPayload = Static<typeof BackgroundEventPayloadSchema>

export const BackgroundEventSchema = VersionEnvelopeSchema(BackgroundEventPayloadSchema)
export type BackgroundEvent = Static<typeof BackgroundEventSchema>

import { Type, type Static } from '@sinclair/typebox'
import { JobIdSchema, IdempotencyKeySchema } from '../common/id.js'
import { NavinSurfaceSchema } from '../common/surface.js'
import { IsoTimestampSchema } from '../common/envelope.js'
import { NavinErrorSchema } from '../common/error.js'

export const JobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
])
export type JobStatus = Static<typeof JobStatusSchema>

export const JobProgressSchema = Type.Object(
  {
    current: Type.Optional(Type.Number()),
    total: Type.Optional(Type.Number()),
    percentage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    message: Type.String(),
    step: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type JobProgress = Static<typeof JobProgressSchema>

export const JobSchema = Type.Object(
  {
    id: JobIdSchema,
    name: Type.String({ minLength: 1 }),
    surface: NavinSurfaceSchema,
    status: JobStatusSchema,
    idempotencyKey: Type.Optional(IdempotencyKeySchema),
    cancellable: Type.Boolean(),
    resumable: Type.Boolean(),
    progress: Type.Optional(JobProgressSchema),
    payload: Type.Record(Type.String(), Type.Unknown()),
    result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    error: Type.Optional(NavinErrorSchema),
    createdAt: IsoTimestampSchema,
    startedAt: Type.Optional(IsoTimestampSchema),
    completedAt: Type.Optional(IsoTimestampSchema),
  },
  { additionalProperties: false },
)
export type Job = Static<typeof JobSchema>

import { Type, type Static } from '@sinclair/typebox'
import { NavinSurfaceSchema } from './surface.js'
import { IsoTimestampSchema } from './envelope.js'

export const NavinErrorCodeSchema = Type.Union([
  Type.Literal('UNAUTHORIZED'),
  Type.Literal('FORBIDDEN'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('CONFLICT'),
  Type.Literal('VALIDATION_FAILED'),
  Type.Literal('RATE_LIMITED'),
  Type.Literal('INTERNAL_ERROR'),
  Type.Literal('SERVICE_UNAVAILABLE'),
  Type.Literal('RISK_STEP_UP_REQUIRED'),
  Type.Literal('APPROVAL_REQUIRED'),
  Type.Literal('IDEMPOTENCY_CONFLICT'),
  Type.Literal('PRECONDITION_FAILED'),
  Type.Literal('ACTION_BLOCKED'),
  Type.Literal('SESSION_EXPIRED'),
  Type.Literal('BAD_REQUEST'),
])
export type NavinErrorCode = Static<typeof NavinErrorCodeSchema>

export const NavinErrorSchema = Type.Object(
  {
    code: NavinErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
    surface: Type.Optional(NavinSurfaceSchema),
    retryable: Type.Boolean(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    requestId: Type.Optional(Type.String()),
    timestamp: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type NavinError = Static<typeof NavinErrorSchema>

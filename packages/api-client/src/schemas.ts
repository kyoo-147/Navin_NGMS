import { Type, type Static } from '@sinclair/typebox'
import {
  AuditRecordSchema,
  BackgroundEventSchema,
  IntelligenceModeSchema,
  IsoTimestampSchema,
  NavinRelyingPartySchema,
  SessionPrincipalSchema,
  SetupEventSchema,
  SetupSessionSchema,
  SetupStageSchema,
  TargetHostDescriptorSchema,
} from '@navin/contracts'

/**
 * Endpoint-level schemas owned by the API client. Domain payloads themselves stay frozen in
 * `@navin/contracts`; these only describe transport wrappers the daemon exposes for them.
 */

export const HealthStatusSchema = Type.Union([Type.Literal('ok'), Type.Literal('degraded')])
export const HealthResponseSchema = Type.Object(
  {
    status: HealthStatusSchema,
    version: Type.String({ minLength: 1 }),
    uptimeMs: Type.Number({ minimum: 0 }),
    startedAt: Type.Optional(IsoTimestampSchema),
  },
  { additionalProperties: false },
)
export type HealthResponse = Static<typeof HealthResponseSchema>

export const LoginRequestSchema = Type.Object(
  {
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    }),
    password: Type.Optional(Type.String({ minLength: 1 })),
    relyingParty: NavinRelyingPartySchema,
  },
  { additionalProperties: false },
)
export type LoginRequest = Static<typeof LoginRequestSchema>

export const LoginResponseSchema = Type.Object(
  {
    principal: SessionPrincipalSchema,
    token: Type.Optional(Type.String({ minLength: 1 })),
    expiresAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type LoginResponse = Static<typeof LoginResponseSchema>

export const SetupSessionCreateRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    intelligenceMode: Type.Optional(IntelligenceModeSchema),
    targetHost: Type.Optional(TargetHostDescriptorSchema),
    initialStage: Type.Optional(SetupStageSchema),
  },
  { additionalProperties: false },
)
export type SetupSessionCreateRequest = Static<typeof SetupSessionCreateRequestSchema>

export const SetupSessionListSchema = Type.Object(
  { sessions: Type.Array(SetupSessionSchema) },
  { additionalProperties: false },
)
export type SetupSessionList = Static<typeof SetupSessionListSchema>

export const AuditRecordListSchema = Type.Object(
  { records: Type.Array(AuditRecordSchema) },
  { additionalProperties: false },
)
export type AuditRecordList = Static<typeof AuditRecordListSchema>

/** Union of the two envelope event shapes the daemon streams over SSE. */
export const NavinEventSchema = Type.Union([SetupEventSchema, BackgroundEventSchema])
export type NavinEvent = Static<typeof NavinEventSchema>

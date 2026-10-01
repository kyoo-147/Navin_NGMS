import { Type, type Static } from '@sinclair/typebox'
import { UserIdSchema, AccountIdSchema, MailboxIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'
import { NavinRoleSchema, AuthScopeSchema, SessionAssuranceLevelSchema } from './scopes.js'

export const SessionPrincipalSchema = Type.Object(
  {
    userId: UserIdSchema,
    accountId: AccountIdSchema,
    email: Type.String({
      minLength: 3,
      maxLength: 320,
      pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      description: 'Standard RFC email address',
    }),
    roles: Type.Array(NavinRoleSchema, { minItems: 1 }),
    scopes: Type.Array(AuthScopeSchema),
  },
  { additionalProperties: false },
)
export type SessionPrincipal = Static<typeof SessionPrincipalSchema>

export const MailSessionTokenPayloadSchema = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: 128 }),
    principal: SessionPrincipalSchema,
    relyingParty: Type.Literal('navin-mail'),
    surface: Type.Literal('mail'),
    assuranceLevel: SessionAssuranceLevelSchema,
    mailboxId: Type.Optional(MailboxIdSchema),
    issuedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    lastAuthenticatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type MailSessionTokenPayload = Static<typeof MailSessionTokenPayloadSchema>

export const ControlSessionTokenPayloadSchema = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: 128 }),
    principal: SessionPrincipalSchema,
    relyingParty: Type.Literal('navin-control'),
    surface: Type.Union([Type.Literal('control'), Type.Literal('cli')]),
    assuranceLevel: SessionAssuranceLevelSchema,
    mailboxId: Type.Optional(MailboxIdSchema),
    issuedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    lastAuthenticatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
)
export type ControlSessionTokenPayload = Static<typeof ControlSessionTokenPayloadSchema>

export const SessionTokenPayloadSchema = Type.Union([
  MailSessionTokenPayloadSchema,
  ControlSessionTokenPayloadSchema,
])
export type SessionTokenPayload = Static<typeof SessionTokenPayloadSchema>

export const CookieSecurityPolicySchema = Type.Object(
  {
    name: Type.String({
      pattern: '^__Host-[a-zA-Z0-9_-]+$',
      description: 'Cookie name with strict __Host- prefix',
    }),
    secure: Type.Literal(true),
    httpOnly: Type.Literal(true),
    sameSite: Type.Union([Type.Literal('strict'), Type.Literal('lax')]),
    hostOnly: Type.Literal(true),
  },
  { additionalProperties: false },
)
export type CookieSecurityPolicy = Static<typeof CookieSecurityPolicySchema>

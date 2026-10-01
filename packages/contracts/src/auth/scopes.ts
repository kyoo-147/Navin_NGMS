import { Type, type Static } from '@sinclair/typebox'

export const NavinRelyingPartySchema = Type.Union([
  Type.Literal('navin-mail'),
  Type.Literal('navin-control'),
])
export type NavinRelyingParty = Static<typeof NavinRelyingPartySchema>

export const NavinRoleSchema = Type.Union([
  Type.Literal('mail.user'),
  Type.Literal('mail.delegate'),
  Type.Literal('org.support'),
  Type.Literal('org.user_admin'),
  Type.Literal('org.domain_admin'),
  Type.Literal('ops.viewer'),
  Type.Literal('ops.operator'),
  Type.Literal('ops.security_admin'),
  Type.Literal('ops.backup_admin'),
  Type.Literal('ops.super_admin'),
  Type.Literal('platform.developer'),
])
export type NavinRole = Static<typeof NavinRoleSchema>

export const AuthScopeSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-z0-9_-]+:[a-z0-9_*.-]+$',
  description: 'Scoped permission token (e.g. mail:read, control:plan, admin:users)',
})
export type AuthScope = Static<typeof AuthScopeSchema>

export const SessionAssuranceLevelSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('standard'),
  Type.Literal('mfa_verified'),
  Type.Literal('step_up_recent'),
])
export type SessionAssuranceLevel = Static<typeof SessionAssuranceLevelSchema>

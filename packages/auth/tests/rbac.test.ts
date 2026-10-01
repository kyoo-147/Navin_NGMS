import { describe, expect, it } from 'vitest'
import {
  authorize,
  hasScope,
  ROLE_CATALOG,
  rolesForRelyingParty,
  scopeMatches,
  scopesForRoles,
  CONTROL_SCOPES,
  MAIL_SCOPES,
} from '../src/rbac.js'

describe('scoped RBAC', () => {
  it('grants mail scopes only to mail roles on the mail relying party', () => {
    const scopes = scopesForRoles(['mail.user'], 'navin-mail')
    expect(scopes).toContain(MAIL_SCOPES.read)
    expect(scopes).toContain(MAIL_SCOPES.send)
    expect(scopes).not.toContain(CONTROL_SCOPES.apply)
  })

  it('does not grant a control session to a mail-only user', () => {
    expect(rolesForRelyingParty(['mail.user'], 'navin-control')).toEqual([])
    expect(scopesForRoles(['mail.user'], 'navin-control')).toEqual([])
  })

  it('does not grant mail content scopes to operations roles', () => {
    const scopes = scopesForRoles(['ops.super_admin'], 'navin-control')
    expect(scopes).toContain(CONTROL_SCOPES.apply)
    expect(scopes).not.toContain(MAIL_SCOPES.read)
  })

  it('keeps undifferentiated admin out of the catalog', () => {
    expect((ROLE_CATALOG as Record<string, unknown>)['admin']).toBeUndefined()
    expect(Object.keys(ROLE_CATALOG)).toHaveLength(11)
  })

  it('matches wildcard scopes', () => {
    expect(scopeMatches('org:users.*', 'org:users.read')).toBe(true)
    expect(scopeMatches('org:users.*', 'org:users.write')).toBe(true)
    expect(scopeMatches('org:users.*', 'org:aliases.read')).toBe(false)
    expect(scopeMatches('mail:read', 'mail:read')).toBe(true)
    expect(scopeMatches('*', 'anything:at.all')).toBe(true)
    expect(hasScope(['org:users.read'], 'org:users.read')).toBe(true)
  })

  it('denies cross-surface authorization', () => {
    const controlSession = {
      relyingParty: 'navin-control' as const,
      surface: 'control' as const,
      roles: ['ops.super_admin' as const],
      scopes: scopesForRoles(['ops.super_admin'], 'navin-control'),
      assuranceLevel: 'mfa_verified' as const,
    }
    const mailRead = authorize(controlSession, { allOf: [MAIL_SCOPES.read] })
    expect(mailRead.allowed).toBe(false)

    const mailSession = {
      relyingParty: 'navin-mail' as const,
      surface: 'mail' as const,
      roles: ['mail.user' as const],
      scopes: scopesForRoles(['mail.user'], 'navin-mail'),
      assuranceLevel: 'standard' as const,
    }
    const controlApply = authorize(mailSession, { allOf: [CONTROL_SCOPES.apply] })
    expect(controlApply.allowed).toBe(false)

    const mailReadAllowed = authorize(mailSession, { allOf: [MAIL_SCOPES.read] })
    expect(mailReadAllowed.allowed).toBe(true)
  })

  it('enforces minimum assurance and role requirements', () => {
    const session = {
      relyingParty: 'navin-control' as const,
      surface: 'cli' as const,
      roles: ['ops.operator' as const],
      scopes: scopesForRoles(['ops.operator'], 'navin-control'),
      assuranceLevel: 'standard' as const,
    }
    expect(authorize(session, { minAssurance: 'mfa_verified' }).reason).toBe(
      'insufficient_assurance',
    )
    expect(authorize(session, { roles: ['ops.super_admin'] }).reason).toBe('missing_role')
    expect(authorize(session, { relyingParty: 'navin-mail' }).reason).toBe('relying_party_mismatch')
    expect(authorize(session, { allOf: [CONTROL_SCOPES.apply] }).allowed).toBe(true)
  })
})

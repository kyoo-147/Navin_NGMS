import { describe, expect, it } from 'vitest'
import {
  canOpenControl,
  canOpenMail,
  defaultModule,
  hasScope,
  scopeMatches,
} from '../src/shell/permissions'

describe('permission gating', () => {
  it('gives mail users Mail but never Control', () => {
    const user = { roles: ['mail.user'], scopes: ['mail:read'] }
    expect(canOpenMail(user)).toBe(true)
    expect(canOpenControl(user)).toBe(false)
    expect(defaultModule(user)).toBe('mail')
  })

  it('lands control-only operators in Control', () => {
    const operator = { roles: ['ops.operator'], scopes: ['control:plan'] }
    expect(canOpenMail(operator)).toBe(false)
    expect(canOpenControl(operator)).toBe(true)
    expect(defaultModule(operator)).toBe('control')
  })

  it('matches wildcard scopes within a namespace only', () => {
    expect(scopeMatches('control:*', 'control:plan')).toBe(true)
    expect(scopeMatches('control:*', 'mail:read')).toBe(false)
    expect(scopeMatches('mail:read', 'mail:read')).toBe(true)
    expect(hasScope({ roles: [], scopes: ['control:*'] }, 'control:apply')).toBe(true)
    expect(hasScope({ roles: [], scopes: [] }, 'control:apply')).toBe(false)
  })

  it('returns no module for anonymous sessions', () => {
    expect(defaultModule({ roles: [], scopes: [] })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { ModuleNotEntitledError } from '../src/shell/errors'
import {
  availableModules,
  isModuleEntitled,
  loadSurfaceModule,
  moduleContributions,
} from '../src/shell/module-registry'

const mailUser = { roles: ['mail.user'], scopes: ['mail:read'] }
const admin = { roles: ['ops.super_admin'], scopes: ['control:*', 'mail:read'] }

describe('lazy module registry', () => {
  it('exposes exactly the mail and control contributions', () => {
    expect(moduleContributions.map((contribution) => contribution.id)).toEqual(['mail', 'control'])
  })

  it('only offers entitled modules', () => {
    expect(availableModules(mailUser).map((contribution) => contribution.id)).toEqual(['mail'])
    expect(availableModules(admin).map((contribution) => contribution.id)).toEqual([
      'mail',
      'control',
    ])
  })

  it('lazily imports an entitled module', async () => {
    const surfaceModule = await loadSurfaceModule('mail', mailUser)
    expect(surfaceModule.id).toBe('mail')
    expect(typeof surfaceModule.mount).toBe('function')
  })

  it('fails closed for unentitled or unknown modules', async () => {
    await expect(loadSurfaceModule('control', mailUser)).rejects.toBeInstanceOf(
      ModuleNotEntitledError,
    )
    await expect(loadSurfaceModule('nope', admin)).rejects.toBeInstanceOf(ModuleNotEntitledError)
    expect(isModuleEntitled('control', mailUser)).toBe(false)
    expect(isModuleEntitled('unknown', admin)).toBe(false)
  })
})

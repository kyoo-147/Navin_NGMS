import { describe, it, expect } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  validate,
  assertValid,
  isValid,
  getValidator,
  applyDefaults,
  validateWithDefaults,
  assertValidWithDefaults,
  NavinContractValidationError,
} from '../src/index.js'

describe('Validation Helpers', () => {
  const UserProfileSchema = Type.Object(
    {
      username: Type.String({ minLength: 3 }),
      age: Type.Number({ minimum: 18 }),
      tags: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  )

  it('isValid returns true for valid data and false for invalid data', () => {
    expect(isValid(UserProfileSchema, { username: 'alice', age: 25, tags: ['admin'] })).toBe(true)
    expect(isValid(UserProfileSchema, { username: 'al', age: 25, tags: [] })).toBe(false)
    expect(isValid(UserProfileSchema, { username: 'alice', age: 16, tags: [] })).toBe(false)
    expect(isValid(UserProfileSchema, null)).toBe(false)
  })

  it('validate returns structured success with typed data', () => {
    const res = validate(UserProfileSchema, { username: 'bob_builder', age: 30, tags: ['dev'] })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.username).toBe('bob_builder')
      expect(res.data.age).toBe(30)
    }
  })

  it('validate returns structured error items with paths and messages', () => {
    const res = validate(UserProfileSchema, {
      username: 'bo',
      age: 10,
      tags: ['dev'],
      extraProp: true,
    })
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.errors.length).toBeGreaterThan(0)
      const paths = res.errors.map((e) => e.path)
      expect(paths.some((p) => p === '/username' || p === '/age' || p === '/extraProp')).toBe(true)
    }
  })

  it('assertValid succeeds on valid input and throws NavinContractValidationError on invalid input', () => {
    expect(() =>
      assertValid(UserProfileSchema, { username: 'charlie', age: 22, tags: [] }),
    ).not.toThrow()

    expect(() => assertValid(UserProfileSchema, { username: 'x', age: 12, tags: [] })).toThrow(
      NavinContractValidationError,
    )
  })

  it('getValidator caches compiled validators', () => {
    const v1 = getValidator(UserProfileSchema)
    const v2 = getValidator(UserProfileSchema)
    expect(v1).toBe(v2)
  })

  const SettingsWithDefaultsSchema = Type.Object(
    {
      theme: Type.String({ default: 'system' }),
      notifications: Type.Boolean({ default: true }),
      quota: Type.Number(),
    },
    { additionalProperties: false },
  )

  it('applyDefaults fills in missing values without mutating the original object', () => {
    const original = { quota: 100 }
    const filled = applyDefaults(SettingsWithDefaultsSchema, original)
    expect(filled).toEqual({
      theme: 'system',
      notifications: true,
      quota: 100,
    })
    expect(original).toEqual({ quota: 100 }) // immutability preserved
  })

  it('validateWithDefaults populates defaults and succeeds on partial objects', () => {
    const res = validateWithDefaults(SettingsWithDefaultsSchema, { quota: 50 })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.theme).toBe('system')
      expect(res.data.notifications).toBe(true)
      expect(res.data.quota).toBe(50)
    }
  })

  it('assertValidWithDefaults populates defaults or throws on invalid input', () => {
    expect(() => assertValidWithDefaults(SettingsWithDefaultsSchema, { quota: 50 })).not.toThrow()
    expect(() => assertValidWithDefaults(SettingsWithDefaultsSchema, { quota: 'invalid' })).toThrow(
      NavinContractValidationError,
    )
  })
})

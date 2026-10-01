import { describe, expect, it } from 'vitest'
import { AuthError } from '../src/errors.js'
import {
  DEFAULT_PASSWORD_POLICY,
  hashPassword,
  passwordNeedsRehash,
  validatePasswordPolicy,
  verifyPassword,
  type ScryptParams,
} from '../src/password.js'
import { DeterministicRandom } from '../src/random.js'

const FAST_PARAMS: Partial<ScryptParams> = { N: 1024, r: 8, p: 1 }

describe('local admin password hashing', () => {
  it('hashes with scrypt and verifies the correct password', () => {
    const encoded = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    expect(encoded.startsWith('scrypt$1024$8$1$')).toBe(true)
    expect(verifyPassword('correct horse battery staple', encoded)).toBe(true)
  })

  it('rejects the wrong password', () => {
    const encoded = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    expect(verifyPassword('wrong password value', encoded)).toBe(false)
  })

  it('never embeds the plaintext password in the encoded verifier', () => {
    const encoded = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    expect(encoded).not.toContain('correct horse battery staple')
  })

  it('salts each hash so identical passwords produce different verifiers', () => {
    const a = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    const b = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    expect(a).not.toEqual(b)
    expect(verifyPassword('correct horse battery staple', a)).toBe(true)
    expect(verifyPassword('correct horse battery staple', b)).toBe(true)
  })

  it('uses injected randomness for the salt deterministically', () => {
    const random = new DeterministicRandom('salt-seed')
    const first = hashPassword('deterministic password value', { params: FAST_PARAMS, random })
    const second = hashPassword('deterministic password value', { params: FAST_PARAMS, random })
    expect(first).not.toEqual(second)
  })

  it('returns false for malformed verifiers instead of throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(verifyPassword('x', 'scrypt$abc$8$1$AAAA$AAAA')).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
  })

  it('enforces password policy', () => {
    expect(() => validatePasswordPolicy('short')).toThrowError(AuthError)
    expect(() => validatePasswordPolicy('short')).toThrowError(/Password does not meet policy/)
    expect(() =>
      validatePasswordPolicy('x'.repeat(DEFAULT_PASSWORD_POLICY.maxLength + 1)),
    ).toThrowError(AuthError)
    expect(() => validatePasswordPolicy('long enough password')).not.toThrow()
  })

  it('flags verifiers produced with different scrypt parameters for rehash', () => {
    const encoded = hashPassword('correct horse battery staple', { params: FAST_PARAMS })
    expect(passwordNeedsRehash(encoded, { ...FAST_PARAMS, N: 2048 } as ScryptParams)).toBe(true)
    expect(passwordNeedsRehash(encoded, FAST_PARAMS as ScryptParams)).toBe(false)
    expect(passwordNeedsRehash('garbage')).toBe(true)
  })
})

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { fromBase64Url, toBase64Url } from './encoding.js'
import { AuthError } from './errors.js'
import type { RandomSource } from './random.js'

export interface ScryptParams {
  N: number
  r: number
  p: number
  keyLength: number
  saltLength: number
  maxmem: number
}

/**
 * Hard bounds applied to any scrypt parameters, including those parsed out of a
 * stored verifier. They cap memory/time so a crafted or corrupted hash cannot
 * trigger a huge allocation or unbounded computation.
 */
export const SCRYPT_LIMITS = {
  minN: 2,
  maxN: 1 << 20,
  minR: 1,
  maxR: 32,
  minP: 1,
  maxP: 16,
  minKeyLength: 16,
  maxKeyLength: 64,
  minSaltLength: 8,
  maxSaltLength: 64,
  maxMemoryBytes: 128 * 1024 * 1024,
  maxPasswordLength: 4096,
  maxEncodedLength: 512,
} as const

/**
 * OWASP-recommended scrypt work factor (2^15, r=8, p=1). `maxmem` is raised
 * above the derived 128*N*r requirement so the parameters are accepted on all
 * supported Node versions.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 1 << 15,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 64 * 1024 * 1024,
}

export interface PasswordPolicy {
  minLength: number
  maxLength: number
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 1024,
}

const ENCODING_PREFIX = 'scrypt'

export function validatePasswordPolicy(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): void {
  if (typeof password !== 'string' || password.length < policy.minLength) {
    throw new AuthError('PASSWORD_POLICY', { reason: 'too_short', minLength: policy.minLength })
  }
  if (password.length > policy.maxLength) {
    throw new AuthError('PASSWORD_POLICY', { reason: 'too_long', maxLength: policy.maxLength })
  }
}

/** Throws when scrypt parameters fall outside {@link SCRYPT_LIMITS}. */
export function assertScryptParams(params: ScryptParams): void {
  const problem = scryptParamsProblem(params)
  if (problem) {
    throw new AuthError('VALIDATION_FAILED', { reason: problem })
  }
}

export function hashPassword(
  password: string,
  options: { params?: Partial<ScryptParams>; random?: RandomSource } = {},
): string {
  if (typeof password !== 'string') {
    throw new AuthError('VALIDATION_FAILED', { reason: 'password_not_string' })
  }
  if (password.length > SCRYPT_LIMITS.maxPasswordLength) {
    throw new AuthError('PASSWORD_POLICY', {
      reason: 'too_long',
      maxLength: SCRYPT_LIMITS.maxPasswordLength,
    })
  }
  const params = { ...DEFAULT_SCRYPT_PARAMS, ...options.params }
  assertScryptParams(params)
  const salt = options.random
    ? options.random.bytes(params.saltLength)
    : randomSalt(params.saltLength)
  const derived = scryptSync(password, Buffer.from(salt), params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  })
  return [
    ENCODING_PREFIX,
    params.N,
    params.r,
    params.p,
    toBase64Url(salt),
    toBase64Url(derived),
  ].join('$')
}

/**
 * Constant-time verification. Returns `false` (never throws) for malformed,
 * over-limit or truncated verifiers, and for passwords outside the accepted
 * length bounds, so hostile input cannot cause an unbounded computation.
 */
export function verifyPassword(password: string, encoded: string): boolean {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > SCRYPT_LIMITS.maxPasswordLength
  ) {
    return false
  }
  const parsed = parsePasswordHash(encoded)
  if (!parsed) {
    return false
  }
  try {
    const maxmem = Math.max(DEFAULT_SCRYPT_PARAMS.maxmem, 128 * parsed.N * parsed.r + 1024)
    const derived = new Uint8Array(
      scryptSync(password, Buffer.from(parsed.salt), parsed.hash.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem,
      }),
    )
    if (derived.length !== parsed.hash.length) {
      return false
    }
    return timingSafeEqual(Buffer.from(derived), Buffer.from(parsed.hash))
  } catch {
    return false
  }
}

export function passwordNeedsRehash(
  encoded: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): boolean {
  const parsed = parsePasswordHash(encoded)
  if (!parsed) {
    return true
  }
  return parsed.N !== params.N || parsed.r !== params.r || parsed.p !== params.p
}

interface ParsedPasswordHash {
  N: number
  r: number
  p: number
  salt: Uint8Array
  hash: Uint8Array
}

function scryptParamsProblem(params: ScryptParams): string | undefined {
  const { N, r, p, keyLength, saltLength } = params
  if (
    !Number.isInteger(N) ||
    N < SCRYPT_LIMITS.minN ||
    N > SCRYPT_LIMITS.maxN ||
    (N & (N - 1)) !== 0
  ) {
    return 'invalid_scrypt_N'
  }
  if (!Number.isInteger(r) || r < SCRYPT_LIMITS.minR || r > SCRYPT_LIMITS.maxR) {
    return 'invalid_scrypt_r'
  }
  if (!Number.isInteger(p) || p < SCRYPT_LIMITS.minP || p > SCRYPT_LIMITS.maxP) {
    return 'invalid_scrypt_p'
  }
  if (
    !Number.isInteger(keyLength) ||
    keyLength < SCRYPT_LIMITS.minKeyLength ||
    keyLength > SCRYPT_LIMITS.maxKeyLength
  ) {
    return 'invalid_scrypt_key_length'
  }
  if (
    !Number.isInteger(saltLength) ||
    saltLength < SCRYPT_LIMITS.minSaltLength ||
    saltLength > SCRYPT_LIMITS.maxSaltLength
  ) {
    return 'invalid_scrypt_salt_length'
  }
  if (128 * N * r > SCRYPT_LIMITS.maxMemoryBytes) {
    return 'scrypt_memory_exceeded'
  }
  return undefined
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | undefined {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    encoded.length > SCRYPT_LIMITS.maxEncodedLength
  ) {
    return undefined
  }
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== ENCODING_PREFIX) {
    return undefined
  }
  // Reject non-decimal forms (e.g. "1e9", "0x10", "-1", "+1") outright.
  if (
    !/^\d{1,7}$/.test(parts[1]!) ||
    !/^\d{1,3}$/.test(parts[2]!) ||
    !/^\d{1,3}$/.test(parts[3]!)
  ) {
    return undefined
  }
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  let salt: Uint8Array
  let hash: Uint8Array
  try {
    salt = fromBase64Url(parts[4]!)
    hash = fromBase64Url(parts[5]!)
  } catch {
    return undefined
  }
  const problem = scryptParamsProblem({
    N,
    r,
    p,
    keyLength: hash.length,
    saltLength: salt.length,
    maxmem: 0,
  })
  if (problem) {
    return undefined
  }
  return { N, r, p, salt, hash }
}

function randomSalt(length: number): Uint8Array {
  return new Uint8Array(randomBytes(length))
}

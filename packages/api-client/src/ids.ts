import type { IdempotencyKey } from '@navin/contracts'

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoObject = globalThis.crypto
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes)
    return bytes
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function randomToken(length: number): string {
  const bytes = randomBytes(length)
  let token = ''
  for (let index = 0; index < length; index += 1) {
    token += ID_ALPHABET[(bytes[index] ?? 0) % ID_ALPHABET.length]
  }
  return token
}

/**
 * Creates an RFC-safe idempotency key matching the `@navin/contracts` IdempotencyKey pattern.
 */
export function createIdempotencyKey(prefix = 'idmp'): IdempotencyKey {
  return `${prefix}_${randomToken(24)}` as IdempotencyKey
}

/**
 * Creates a correlation id attached to requests and error reports.
 */
export function createCorrelationId(prefix = 'cor'): string {
  return `${prefix}_${randomToken(24)}`
}

/**
 * Fills in a missing idempotency key while preserving a caller-provided one.
 */
export function withIdempotencyKey<T extends { idempotencyKey?: string }>(
  input: T,
  factory: () => IdempotencyKey,
): T & { idempotencyKey: string } {
  return { ...input, idempotencyKey: input.idempotencyKey ?? factory() }
}

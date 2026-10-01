import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { toBase64Url } from './encoding.js'

/** Injectable source of cryptographic randomness and opaque identifiers. */
export interface RandomSource {
  bytes(length: number): Uint8Array
  uuid(): string
  id(prefix: string): string
}

export class SystemRandom implements RandomSource {
  bytes(length: number): Uint8Array {
    return new Uint8Array(randomBytes(length))
  }

  uuid(): string {
    return randomUUID()
  }

  id(prefix: string): string {
    return `${prefix}_${toBase64Url(this.bytes(12))}`
  }
}

/**
 * Deterministic randomness derived from a seed. Test-only: never use for
 * production secrets. Provided so rotation, issuance and restart tests are
 * fully reproducible.
 */
export class DeterministicRandom implements RandomSource {
  private counter = 0

  constructor(private readonly seed: string) {}

  bytes(length: number): Uint8Array {
    const output = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const block = createHash('sha256').update(`${this.seed}:${this.counter}`).digest()
      this.counter += 1
      const take = Math.min(block.length, length - offset)
      output.set(block.subarray(0, take), offset)
      offset += take
    }
    return output
  }

  uuid(): string {
    const bytes = this.bytes(16)
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  id(prefix: string): string {
    return `${prefix}_${toBase64Url(this.bytes(12))}`
  }
}

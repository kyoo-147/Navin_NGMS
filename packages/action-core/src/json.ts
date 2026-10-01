import { createHash } from 'node:crypto'

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  const source = value as Record<string, unknown>
  const entries = Object.keys(source)
    .filter((key) => source[key] !== undefined)
    .sort()
    .map((key) => [key, normalize(source[key])] as const)
  return Object.fromEntries(entries)
}

/**
 * Deterministic JSON used for request hashing and evidence digests.
 * Object keys are sorted so equal values always produce equal bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256Bytes(value: Uint8Array | string): string {
  const hash = createHash('sha256').update(value).digest('hex')
  return `sha256:${hash}`
}

export function sha256Digest(value: unknown): string {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'))
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value)
}

export function parseJson<T>(text: string | null | undefined): T | undefined {
  if (text === null || text === undefined || text === '') {
    return undefined
  }
  return JSON.parse(text) as T
}

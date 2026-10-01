export const REDACTED = '[REDACTED]'
export const TRUNCATED = '[TRUNCATED]'

const DEFAULT_SENSITIVE_KEY =
  /password|passphrase|passwd|passcode|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|private[_-]?key|credential|refresh[_-]?token|access[_-]?token|client[_-]?secret|bearer|session[_-]?id|\b(?:otp|pin)\b/i

export interface RedactionOptions {
  maxDepth?: number
  sensitiveKeys?: RegExp
}

function redactString(value: string): string {
  if (/bearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) {
    return REDACTED
  }
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) {
    return REDACTED
  }
  return value
}

function walk(value: unknown, sensitiveKeys: RegExp, maxDepth: number, depth: number): unknown {
  if (value === null || value === undefined) {
    return value
  }
  const kind = typeof value
  if (kind === 'string') {
    return redactString(value as string)
  }
  if (kind === 'number' || kind === 'boolean' || kind === 'bigint') {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      return TRUNCATED
    }
    return value.map((item) => walk(item, sensitiveKeys, maxDepth, depth + 1))
  }
  if (kind === 'object') {
    if (depth >= maxDepth) {
      return TRUNCATED
    }
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sensitiveKeys.test(key)
        ? REDACTED
        : walk(item, sensitiveKeys, maxDepth, depth + 1)
    }
    return output
  }
  return String(value)
}

/**
 * Returns a deep copy with credential-shaped keys and inline bearer/private-key
 * material replaced by `[REDACTED]`. The input value is never mutated.
 */
export function redact<T>(value: T, options: RedactionOptions = {}): T {
  const maxDepth = options.maxDepth ?? 8
  const sensitiveKeys = options.sensitiveKeys ?? DEFAULT_SENSITIVE_KEY
  return walk(value, sensitiveKeys, maxDepth, 0) as T
}

export function redactRecord(
  value: Record<string, unknown> | undefined,
  options: RedactionOptions = {},
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }
  return redact(value, options)
}

export function containsSensitiveKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some(containsSensitiveKey)
  }
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => DEFAULT_SENSITIVE_KEY.test(key) || containsSensitiveKey(item),
  )
}

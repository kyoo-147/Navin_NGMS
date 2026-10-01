export const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|hash|salt|credential|authorization|cookie|csrf|privatekey|private_key|apikey|api_key)/i

/**
 * Returns a structurally cloned value with secret-bearing fields replaced.
 * Byte sequences are treated as opaque and always redacted. The original value
 * is never mutated, so callers can safely hand user input to a log sink.
 */
export function redactUnknown(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Uint8Array) {
    return REDACTED
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return REDACTED
    }
    seen.add(value)
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactUnknown(entry, seen)
    }
    return output
  }
  return value
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return redactUnknown(record) as Record<string, unknown>
}

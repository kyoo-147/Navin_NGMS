export const REDACTED = '[redacted]'

const DEFAULT_MAX_DEPTH = 8

/** Literals shorter than this are ignored to avoid masking ordinary text. */
export const MIN_LITERAL_LENGTH = 8

const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'credential',
]

const SENSITIVE_SUFFIXES = ['key', 'keys']

const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const BASIC_TOKEN_PATTERN = /\bBasic\s+[A-Za-z0-9+/=]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|secret|token|api[-_]?key|apikey|authorization|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;"'&]+)/gi

/**
 * Returns true when a field name should be treated as carrying a secret.
 *
 * Matching is intentionally conservative: any name containing one of the
 * known secret markers, or ending in `key`, is treated as sensitive so that
 * newly introduced credential fields fail closed rather than leak.
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (SENSITIVE_SUBSTRINGS.some((marker) => lower.includes(marker))) {
    return true
  }
  return SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/**
 * Redact secrets embedded in free text.
 *
 * Handles the two cases field-name matching cannot: exact secret literals
 * registered at startup (for example configuration values), and common
 * credential shapes (`Bearer`/`Basic` headers, JWTs and `key=value` pairs).
 * This is deliberately conservative and runs over every log string, error
 * message and stack trace.
 */
export function redactText(text: string, literals: readonly string[] = []): string {
  let result = text
  for (const literal of literals) {
    if (literal.length >= MIN_LITERAL_LENGTH && result.includes(literal)) {
      result = result.split(literal).join(REDACTED)
    }
  }
  result = result.replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
  result = result.replace(BASIC_TOKEN_PATTERN, `Basic ${REDACTED}`)
  result = result.replace(JWT_PATTERN, REDACTED)
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
  return result
}

export interface RedactOptions {
  /** When false, only converts values to a JSON-safe shape without masking. */
  redact?: boolean
  maxDepth?: number
  /** Exact secret values scrubbed from any string, message or stack. */
  literals?: readonly string[]
}

function normalizeLiterals(literals: readonly string[] | undefined): string[] {
  if (!literals) {
    return []
  }
  return literals.filter((literal) => literal.length >= MIN_LITERAL_LENGTH)
}

/**
 * Convert an arbitrary value into a JSON-safe structure.
 *
 * Cycles, `Error` instances, `bigint`, functions and over-deep structures are
 * normalized so logging never throws. When `redact` is enabled (the default)
 * sensitive field names and embedded credential text are masked.
 */
export function redactValue(value: unknown, options: RedactOptions = {}): unknown {
  const redact = options.redact ?? true
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const literals = redact ? normalizeLiterals(options.literals) : []
  return visit(value, redact, literals, new WeakSet<object>(), 0, maxDepth)
}

function visit(
  value: unknown,
  redact: boolean,
  literals: readonly string[],
  seen: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return redact ? redactText(value, literals) : value
  }

  const valueType = typeof value
  if (valueType === 'number' || valueType === 'boolean') {
    return value
  }
  if (valueType === 'bigint') {
    return value.toString()
  }
  if (valueType === 'function') {
    return '[function]'
  }
  if (valueType === 'symbol') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Error) {
    return visitError(value, redact, literals, seen, depth, maxDepth)
  }

  if (depth >= maxDepth) {
    return '[max-depth]'
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]'
    }
    seen.add(value)
    return value.map((item) => visit(item, redact, literals, seen, depth + 1, maxDepth))
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      return '[circular]'
    }
    seen.add(value)
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
      result[key] =
        redact && isSensitiveKey(key)
          ? REDACTED
          : visit(source[key], redact, literals, seen, depth + 1, maxDepth)
    }
    return result
  }

  return String(value)
}

function visitError(
  error: Error,
  redact: boolean,
  literals: readonly string[],
  seen: WeakSet<object>,
  depth: number,
  maxDepth: number,
): unknown {
  if (seen.has(error)) {
    return '[circular]'
  }
  seen.add(error)

  const result: Record<string, unknown> = {
    name: error.name,
    message: redact ? redactText(error.message, literals) : error.message,
  }
  if (error.stack) {
    result.stack = redact ? redactText(error.stack, literals) : error.stack
  }
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue
    }
    const nested = (error as unknown as Record<string, unknown>)[key]
    result[key] =
      redact && isSensitiveKey(key)
        ? REDACTED
        : visit(nested, redact, literals, seen, depth + 1, maxDepth)
  }
  return result
}

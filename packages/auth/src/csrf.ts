import { constantTimeEqual, toBase64Url } from './encoding.js'
import { AuthError } from './errors.js'
import { hmacSha256 } from './tokens.js'

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Derives a per-session CSRF token as `HMAC(secret, "csrf:" + sessionId)`.
 * Because it is bound to the session identifier, it rotates automatically when
 * the session rotates and cannot be replayed across sessions.
 */
export function deriveCsrfToken(sessionId: string, secret: Uint8Array): string {
  return toBase64Url(hmacSha256(secret, `csrf:${sessionId}`))
}

export function verifyCsrfToken(provided: unknown, sessionId: string, secret: Uint8Array): boolean {
  if (typeof provided !== 'string' || provided.length === 0) {
    return false
  }
  const expected = deriveCsrfToken(sessionId, secret)
  return constantTimeEqual(new TextEncoder().encode(provided), new TextEncoder().encode(expected))
}

export interface OriginInput {
  origin?: string | null
  referer?: string | null
  host?: string | null
}

/**
 * Fail-closed origin check for state-changing requests. The `Origin` header (or
 * `Referer` as a fallback) must exactly match an allowlisted origin.
 */
export function verifyOrigin(input: OriginInput, allowedOrigins: readonly string[]): boolean {
  if (allowedOrigins.length === 0) {
    return false
  }
  const candidate = normalizeOrigin(input.origin ?? originFromReferer(input.referer) ?? null)
  if (!candidate) {
    return false
  }
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === candidate)
}

function originFromReferer(referer: string | null | undefined): string | null {
  if (!referer) {
    return null
  }
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) {
    return null
  }
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

export interface StateChangingRequest {
  method: string
  sessionId: string
  csrfSecret: Uint8Array
  csrfToken?: string | null
  origin?: string | null
  referer?: string | null
  host?: string | null
  allowedOrigins: readonly string[]
}

/**
 * Combined CSRF + origin gate. Safe methods pass through; every other method
 * must present an allowlisted origin and a session-bound CSRF token. Origin is
 * checked before the token so a cross-site request fails closed.
 */
export function assertStateChangingRequest(request: StateChangingRequest): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return
  }
  if (!verifyOrigin(request, request.allowedOrigins)) {
    throw new AuthError('ORIGIN_FORBIDDEN')
  }
  if (!verifyCsrfToken(request.csrfToken, request.sessionId, request.csrfSecret)) {
    throw new AuthError('CSRF_FAILED')
  }
}

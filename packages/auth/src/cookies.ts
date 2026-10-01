import { AuthError } from './errors.js'
import type { CookiePolicy, RelyingParty } from './types.js'

const HOST_COOKIE_PREFIX = '__Host-'

/**
 * Mail sessions favour daily continuity but stay host-only. Control sessions
 * are stricter (`SameSite=Strict`) and never share a cookie with Mail.
 */
export const MAIL_SESSION_COOKIE: CookiePolicy = {
  name: '__Host-navin_mail_session',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  hostOnly: true,
}

export const CONTROL_SESSION_COOKIE: CookiePolicy = {
  name: '__Host-navin_control_session',
  secure: true,
  httpOnly: true,
  sameSite: 'strict',
  hostOnly: true,
}

export function sessionCookiePolicyFor(relyingParty: RelyingParty): CookiePolicy {
  return relyingParty === 'navin-mail' ? MAIL_SESSION_COOKIE : CONTROL_SESSION_COOKIE
}

export function isHostCookieName(name: string): boolean {
  return name.startsWith(HOST_COOKIE_PREFIX) && name.length > HOST_COOKIE_PREFIX.length
}

/**
 * Enforces the `__Host-` contract: Secure, HttpOnly, host-only, and the
 * `__Host-` prefix (which itself forbids a `Domain` attribute and requires
 * `Path=/`). Throws rather than emitting a weakening cookie.
 */
export function assertCookiePolicy(policy: CookiePolicy): void {
  if (!isHostCookieName(policy.name)) {
    throw new AuthError('VALIDATION_FAILED', { reason: 'cookie_missing_host_prefix' })
  }
  if (policy.secure !== true || policy.httpOnly !== true || policy.hostOnly !== true) {
    throw new AuthError('VALIDATION_FAILED', { reason: 'cookie_not_host_secure' })
  }
}

export interface SessionCookieOptions {
  maxAgeSeconds: number
  expires?: Date
}

/**
 * Serializes a host-only session cookie. The `Domain` attribute is never
 * emitted, and `Path=/` is required by the `__Host-` prefix.
 */
export function buildSessionCookie(
  policy: CookiePolicy,
  value: string,
  options: SessionCookieOptions,
): string {
  assertCookiePolicy(policy)
  const sameSite = policy.sameSite === 'strict' ? 'Strict' : 'Lax'
  const parts = [
    `${policy.name}=${encodeURIComponent(value)}`,
    'Path=/',
    'Secure',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ]
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }
  return parts.join('; ')
}

export function buildClearedSessionCookie(policy: CookiePolicy): string {
  assertCookiePolicy(policy)
  const sameSite = policy.sameSite === 'strict' ? 'Strict' : 'Lax'
  return [
    `${policy.name}=`,
    'Path=/',
    'Secure',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ')
}

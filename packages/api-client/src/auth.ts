import type { NavinSurface } from '@navin/contracts'
import type { RequestCredentials } from './transport.js'

/**
 * Authentication strategy attached to a client. Mail and Control never share one: Mail uses a
 * host-only cookie/BFF session, Control and CLI use scoped bearer tokens.
 */
export interface AuthContext {
  readonly surface: NavinSurface
  readonly credentials?: RequestCredentials
  headers(): Record<string, string> | Promise<Record<string, string>>
}

export function anonymousAuthContext(surface: NavinSurface): AuthContext {
  return {
    surface,
    headers: () => ({}),
  }
}

export interface BearerAuthOptions {
  surface: NavinSurface
  token: string | (() => string | Promise<string>)
  headerName?: string
  scheme?: string
}

export function bearerAuthContext(options: BearerAuthOptions): AuthContext {
  const headerName = (options.headerName ?? 'authorization').toLowerCase()
  const scheme = options.scheme ?? 'Bearer'
  return {
    surface: options.surface,
    async headers(): Promise<Record<string, string>> {
      const resolved = typeof options.token === 'function' ? await options.token() : options.token
      if (!resolved) return {}
      return { [headerName]: `${scheme} ${resolved}` }
    },
  }
}

export interface CookieAuthOptions {
  surface: NavinSurface
  credentials?: RequestCredentials
}

export function cookieAuthContext(options: CookieAuthOptions): AuthContext {
  return {
    surface: options.surface,
    credentials: options.credentials ?? 'include',
    headers: () => ({}),
  }
}

export interface StaticHeaderAuthOptions {
  surface: NavinSurface
  headers: Record<string, string>
  credentials?: RequestCredentials
}

/** Escape hatch for pre-computed headers, e.g. an explicit Cookie header in tests. */
export function staticHeaderAuthContext(options: StaticHeaderAuthOptions): AuthContext {
  const headers = { ...options.headers }
  return {
    surface: options.surface,
    credentials: options.credentials,
    headers: () => ({ ...headers }),
  }
}

import type { NavinSurface } from './surface-types'

export type SurfaceModuleId = NavinSurface

export interface Entitlements {
  readonly roles: readonly string[]
  readonly scopes: readonly string[]
}

const CONTROL_ROLES: ReadonlySet<string> = new Set([
  'org.support',
  'org.user_admin',
  'org.domain_admin',
  'ops.viewer',
  'ops.operator',
  'ops.security_admin',
  'ops.backup_admin',
  'ops.super_admin',
  'platform.developer',
])

const MAIL_ROLES: ReadonlySet<string> = new Set(['mail.user', 'mail.delegate'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A granted scope may contain `*` wildcards (e.g. `control:*`). Scope matching is
 * intentionally deny-by-default: an exact match, or a wildcard match on the whole
 * scoped token, is required.
 */
export function scopeMatches(granted: string, required: string): boolean {
  if (granted === required) return true
  if (!granted.includes('*')) return false
  const pattern = new RegExp(`^${granted.split('*').map(escapeRegExp).join('.*')}$`)
  return pattern.test(required)
}

export function hasScope(entitlements: Entitlements, required: string): boolean {
  return entitlements.scopes.some((granted) => scopeMatches(granted, required))
}

export function hasAnyScopeInNamespace(entitlements: Entitlements, namespace: string): boolean {
  const prefix = `${namespace}:`
  return entitlements.scopes.some((scope) => scope.startsWith(prefix))
}

function hasAnyRole(entitlements: Entitlements, roles: ReadonlySet<string>): boolean {
  return entitlements.roles.some((role) => roles.has(role))
}

/** Control is permission-gated: both the scopes and the role set must be absent to deny. */
export function canOpenControl(entitlements: Entitlements): boolean {
  return hasAnyScopeInNamespace(entitlements, 'control') || hasAnyRole(entitlements, CONTROL_ROLES)
}

export function canOpenMail(entitlements: Entitlements): boolean {
  return hasAnyScopeInNamespace(entitlements, 'mail') || hasAnyRole(entitlements, MAIL_ROLES)
}

/**
 * Mail is the default landing module for anyone with mailbox access; Control-only
 * operators land in Control. Callers with neither entitlement get no module.
 */
export function defaultModule(entitlements: Entitlements): SurfaceModuleId | null {
  if (canOpenMail(entitlements)) return 'mail'
  if (canOpenControl(entitlements)) return 'control'
  return null
}

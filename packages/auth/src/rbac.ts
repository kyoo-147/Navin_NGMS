import {
  assuranceRank,
  type AssuranceLevel,
  type AuthScope,
  type NavinRole,
  type RelyingParty,
  type Surface,
} from './types.js'

export const MAIL_SCOPES = {
  read: 'mail:read',
  write: 'mail:write',
  send: 'mail:send',
  manage: 'mail:manage',
} as const

export const CONTROL_SCOPES = {
  discover: 'control:discover',
  plan: 'control:plan',
  diff: 'control:diff',
  approve: 'control:approve',
  apply: 'control:apply',
  verify: 'control:verify',
  rollback: 'control:rollback',
} as const

export const ORG_SCOPES = {
  usersRead: 'org:users.read',
  usersWrite: 'org:users.write',
  aliasesRead: 'org:aliases.read',
  aliasesWrite: 'org:aliases.write',
  groupsRead: 'org:groups.read',
  groupsWrite: 'org:groups.write',
  domainsRead: 'org:domains.read',
  domainsWrite: 'org:domains.write',
  quotaWrite: 'org:quota.write',
  directoryRead: 'directory:read',
} as const

export const DELIVERY_SCOPES = { read: 'delivery:read', manage: 'delivery:manage' } as const
export const SECURITY_SCOPES = {
  read: 'security:read',
  manage: 'security:manage',
  keys: 'security:keys',
} as const
export const MIGRATION_SCOPES = {
  read: 'migration:read',
  run: 'migration:run',
  cutover: 'migration:cutover',
} as const
export const BACKUP_SCOPES = {
  read: 'backup:read',
  run: 'backup:run',
  restore: 'backup:restore',
} as const
export const AUDIT_SCOPES = { read: 'audit:read', export: 'evidence:export' } as const
export const PLATFORM_SCOPES = {
  aiManage: 'ai:manage',
  extensionManage: 'extension:manage',
  systemUpdate: 'system:update',
} as const

export interface RoleDefinition {
  role: NavinRole
  scopes: readonly AuthScope[]
  relyingParties: readonly RelyingParty[]
  surfaces: readonly Surface[]
}

const CONTROL_SURFACES: readonly Surface[] = ['control', 'cli']
const MAIL_SURFACES: readonly Surface[] = ['mail']

const OPS_VIEWER_SCOPES: readonly AuthScope[] = [
  CONTROL_SCOPES.discover,
  CONTROL_SCOPES.plan,
  DELIVERY_SCOPES.read,
  SECURITY_SCOPES.read,
  MIGRATION_SCOPES.read,
  BACKUP_SCOPES.read,
  AUDIT_SCOPES.read,
]

const ORG_SUPPORT_SCOPES: readonly AuthScope[] = [
  ORG_SCOPES.usersRead,
  ORG_SCOPES.aliasesRead,
  ORG_SCOPES.groupsRead,
  ORG_SCOPES.domainsRead,
  ORG_SCOPES.directoryRead,
  DELIVERY_SCOPES.read,
  AUDIT_SCOPES.read,
]

const ORG_USER_ADMIN_SCOPES: readonly AuthScope[] = [
  ...ORG_SUPPORT_SCOPES,
  ORG_SCOPES.usersWrite,
  ORG_SCOPES.aliasesWrite,
  ORG_SCOPES.groupsWrite,
]

const SUPER_ADMIN_SCOPES: readonly AuthScope[] = [
  ...Object.values(CONTROL_SCOPES),
  ...Object.values(ORG_SCOPES),
  ...Object.values(DELIVERY_SCOPES),
  ...Object.values(SECURITY_SCOPES),
  ...Object.values(MIGRATION_SCOPES),
  ...Object.values(BACKUP_SCOPES),
  ...Object.values(AUDIT_SCOPES),
  ...Object.values(PLATFORM_SCOPES),
]

/**
 * Least-privilege role catalog. Every role is bound to the relying parties and
 * surfaces it may be used from; `ops.*` roles carry no `mail:*` scope, so
 * Control never exposes message bodies by default.
 */
export const ROLE_CATALOG: Record<NavinRole, RoleDefinition> = {
  'mail.user': {
    role: 'mail.user',
    scopes: [MAIL_SCOPES.read, MAIL_SCOPES.write, MAIL_SCOPES.send],
    relyingParties: ['navin-mail'],
    surfaces: MAIL_SURFACES,
  },
  'mail.delegate': {
    role: 'mail.delegate',
    scopes: [MAIL_SCOPES.read, MAIL_SCOPES.write, MAIL_SCOPES.send, MAIL_SCOPES.manage],
    relyingParties: ['navin-mail'],
    surfaces: MAIL_SURFACES,
  },
  'org.support': {
    role: 'org.support',
    scopes: ORG_SUPPORT_SCOPES,
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'org.user_admin': {
    role: 'org.user_admin',
    scopes: ORG_USER_ADMIN_SCOPES,
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'org.domain_admin': {
    role: 'org.domain_admin',
    scopes: [
      ...ORG_USER_ADMIN_SCOPES,
      ORG_SCOPES.domainsWrite,
      ORG_SCOPES.quotaWrite,
      CONTROL_SCOPES.discover,
      CONTROL_SCOPES.plan,
    ],
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'ops.viewer': {
    role: 'ops.viewer',
    scopes: OPS_VIEWER_SCOPES,
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'ops.operator': {
    role: 'ops.operator',
    scopes: [
      ...OPS_VIEWER_SCOPES,
      CONTROL_SCOPES.diff,
      CONTROL_SCOPES.apply,
      CONTROL_SCOPES.verify,
      CONTROL_SCOPES.rollback,
      DELIVERY_SCOPES.manage,
      MIGRATION_SCOPES.run,
      BACKUP_SCOPES.run,
    ],
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'ops.security_admin': {
    role: 'ops.security_admin',
    scopes: [
      CONTROL_SCOPES.discover,
      CONTROL_SCOPES.plan,
      CONTROL_SCOPES.diff,
      CONTROL_SCOPES.approve,
      SECURITY_SCOPES.read,
      SECURITY_SCOPES.manage,
      SECURITY_SCOPES.keys,
      AUDIT_SCOPES.read,
      AUDIT_SCOPES.export,
      PLATFORM_SCOPES.extensionManage,
    ],
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'ops.backup_admin': {
    role: 'ops.backup_admin',
    scopes: [
      CONTROL_SCOPES.discover,
      CONTROL_SCOPES.plan,
      CONTROL_SCOPES.diff,
      CONTROL_SCOPES.apply,
      CONTROL_SCOPES.verify,
      MIGRATION_SCOPES.read,
      MIGRATION_SCOPES.run,
      MIGRATION_SCOPES.cutover,
      BACKUP_SCOPES.read,
      BACKUP_SCOPES.run,
      BACKUP_SCOPES.restore,
      AUDIT_SCOPES.read,
    ],
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'ops.super_admin': {
    role: 'ops.super_admin',
    scopes: SUPER_ADMIN_SCOPES,
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
  'platform.developer': {
    role: 'platform.developer',
    scopes: [
      CONTROL_SCOPES.discover,
      CONTROL_SCOPES.plan,
      CONTROL_SCOPES.diff,
      PLATFORM_SCOPES.aiManage,
      PLATFORM_SCOPES.extensionManage,
    ],
    relyingParties: ['navin-control'],
    surfaces: CONTROL_SURFACES,
  },
}

export function rolesForRelyingParty(
  roles: readonly NavinRole[],
  relyingParty: RelyingParty,
): NavinRole[] {
  return roles.filter((role) => ROLE_CATALOG[role]?.relyingParties.includes(relyingParty))
}

/** Union of the scopes granted by `roles` for a relying party, de-duplicated. */
export function scopesForRoles(
  roles: readonly NavinRole[],
  relyingParty: RelyingParty,
): AuthScope[] {
  const scopes = new Set<AuthScope>()
  for (const role of roles) {
    const definition = ROLE_CATALOG[role]
    if (!definition || !definition.relyingParties.includes(relyingParty)) {
      continue
    }
    for (const scope of definition.scopes) {
      scopes.add(scope)
    }
  }
  return [...scopes]
}

/**
 * Glob match for scoped permissions. `*` matches any run of characters, so
 * `org:users.*` grants `org:users.read`, and `admin:*` grants the whole
 * namespace. Exact matches always win.
 */
export function scopeMatches(granted: AuthScope, required: AuthScope): boolean {
  if (granted === required || granted === '*') {
    return true
  }
  if (!granted.includes('*')) {
    return false
  }
  const escaped = granted.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(required)
}

export function hasScope(granted: readonly AuthScope[], required: AuthScope): boolean {
  return granted.some((scope) => scopeMatches(scope, required))
}

export function authorizeAgainstScopes(
  granted: readonly AuthScope[],
  required: readonly AuthScope[],
): { allowed: boolean; missing: AuthScope[] } {
  const missing = required.filter((scope) => !hasScope(granted, scope))
  return { allowed: missing.length === 0, missing }
}

export interface AuthorizationContext {
  relyingParty: RelyingParty
  surface: Surface
  roles: readonly NavinRole[]
  scopes: readonly AuthScope[]
  assuranceLevel: AssuranceLevel
}

export interface AuthorizationRequirement {
  allOf?: readonly AuthScope[]
  anyOf?: readonly AuthScope[]
  roles?: readonly NavinRole[]
  relyingParty?: RelyingParty
  surfaces?: readonly Surface[]
  minAssurance?: AssuranceLevel
}

export interface AuthorizationDecision {
  allowed: boolean
  reason?: string
  missing?: AuthScope[]
}

/**
 * Deny-by-default authorization. Surface/relying-party isolation is enforced
 * first, then required roles, scopes and minimum assurance.
 */
export function authorize(
  context: AuthorizationContext,
  requirement: AuthorizationRequirement,
): AuthorizationDecision {
  if (requirement.relyingParty && requirement.relyingParty !== context.relyingParty) {
    return { allowed: false, reason: 'relying_party_mismatch' }
  }
  if (requirement.surfaces && !requirement.surfaces.includes(context.surface)) {
    return { allowed: false, reason: 'surface_not_permitted' }
  }
  if (requirement.roles && !requirement.roles.some((role) => context.roles.includes(role))) {
    return { allowed: false, reason: 'missing_role' }
  }
  if (
    requirement.minAssurance &&
    assuranceRank(context.assuranceLevel) < assuranceRank(requirement.minAssurance)
  ) {
    return { allowed: false, reason: 'insufficient_assurance' }
  }
  if (requirement.allOf) {
    const result = authorizeAgainstScopes(context.scopes, requirement.allOf)
    if (!result.allowed) {
      return { allowed: false, reason: 'missing_scope', missing: result.missing }
    }
  }
  if (requirement.anyOf && requirement.anyOf.length > 0) {
    const satisfied = requirement.anyOf.some((scope) => hasScope(context.scopes, scope))
    if (!satisfied) {
      return { allowed: false, reason: 'missing_any_scope', missing: [...requirement.anyOf] }
    }
  }
  return { allowed: true }
}

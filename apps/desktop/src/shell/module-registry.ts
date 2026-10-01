import { ModuleNotEntitledError } from './errors'
import { canOpenControl, canOpenMail, hasScope, type Entitlements } from './permissions'
import type { DeliveryChannel, NavinSurface } from './surface-types'

export interface ModuleContext {
  readonly surface: NavinSurface
  readonly channel: DeliveryChannel
  readonly navindOrigin: string | null
}

export interface SurfaceModule {
  readonly id: NavinSurface
  mount(target: HTMLElement, context: ModuleContext): void | Promise<void>
  unmount?(): void
}

export interface ModuleContribution {
  readonly id: NavinSurface
  readonly label: string
  readonly requiredScopes: readonly string[]
  readonly isEntitled: (entitlements: Entitlements) => boolean
  readonly load: () => Promise<SurfaceModule>
}

/**
 * Mail and Control are independent, lazily loaded bundles. `load` uses a dynamic
 * import so each surface ships as its own chunk and is only fetched when the
 * session is entitled to it. The desktop shell owns composition, never domain logic.
 */
export const moduleContributions: readonly ModuleContribution[] = [
  {
    id: 'mail',
    label: 'Mail',
    requiredScopes: ['mail:read'],
    isEntitled: canOpenMail,
    load: () => import('../modules/mail/index').then((module) => module.surfaceModule),
  },
  {
    id: 'control',
    label: 'Control',
    requiredScopes: ['control:read'],
    isEntitled: canOpenControl,
    load: () => import('../modules/control/index').then((module) => module.surfaceModule),
  },
]

export function findContribution(id: string): ModuleContribution | undefined {
  return moduleContributions.find((contribution) => contribution.id === id)
}

export function availableModules(entitlements: Entitlements): readonly ModuleContribution[] {
  return moduleContributions.filter((contribution) => contribution.isEntitled(entitlements))
}

export function isModuleEntitled(id: string, entitlements: Entitlements): boolean {
  const contribution = findContribution(id)
  if (!contribution) return false
  if (contribution.isEntitled(entitlements)) return true
  return contribution.requiredScopes.some((scope) => hasScope(entitlements, scope))
}

/**
 * Resolve and lazily import a surface module. Fails closed: an unknown or
 * unentitled module never triggers a bundle fetch or a mount.
 */
export async function loadSurfaceModule(
  id: string,
  entitlements: Entitlements,
): Promise<SurfaceModule> {
  const contribution = findContribution(id)
  if (!contribution || !isModuleEntitled(id, entitlements)) {
    throw new ModuleNotEntitledError(id)
  }
  return contribution.load()
}

import { createWebFallbackAdapters } from './web-fallback'
import type { AdapterBundle } from './types'

export type { AdapterBundle } from './types'

let active: AdapterBundle | null = null

export function setAdapters(bundle: AdapterBundle): void {
  active = bundle
}

/**
 * Returns the installed adapter bundle. If nothing was installed yet (for
 * example a test or a web build) the browser fallback bundle is used, which
 * never provides plaintext secret persistence.
 */
export function getAdapters(): AdapterBundle {
  if (active === null) {
    active = createWebFallbackAdapters()
  }
  return active
}

export function resetAdapters(): void {
  active = null
}

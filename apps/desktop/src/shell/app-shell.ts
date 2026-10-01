import { setAdapters } from './adapters'
import { createWebFallbackAdapters } from './adapters/web-fallback'
import { resolveDesktopConfig } from './config'
import { availableModules, loadSurfaceModule } from './module-registry'
import { installNativeAdapters } from './native/tauri-bindings'
import { defaultModule, type Entitlements } from './permissions'
import { detectRuntimePlatform } from './platform'

export interface ShellBootstrapOptions {
  readonly entitlements?: Entitlements
}

const EMPTY_ENTITLEMENTS: Entitlements = { roles: [], scopes: [] }

/**
 * Boot the desktop shell: install the correct adapter bundle for the runtime,
 * render the module navigation, and lazily mount the default entitled surface.
 * The shell maps entitlements to visible modules for UX only; the navind backend
 * remains the authoritative authorization boundary.
 */
export async function bootstrapShell(
  root: HTMLElement,
  options: ShellBootstrapOptions = {},
): Promise<void> {
  const platform = detectRuntimePlatform()
  const config = resolveDesktopConfig()

  if (platform === 'tauri') {
    installNativeAdapters({ updaterEnabled: config.updater.enabled })
  } else {
    setAdapters(createWebFallbackAdapters())
  }

  const entitlements = options.entitlements ?? EMPTY_ENTITLEMENTS
  const modules = availableModules(entitlements)
  const channel = platform === 'tauri' ? 'desktop' : 'web'

  root.replaceChildren()

  const header = document.createElement('header')
  header.className = 'navin-header'
  const title = document.createElement('span')
  title.className = 'navin-title'
  title.textContent = 'Navin'
  const nav = document.createElement('nav')
  nav.className = 'navin-nav'
  header.append(title, nav)

  const host = document.createElement('main')
  host.className = 'navin-module-host'
  root.append(header, host)

  if (modules.length === 0) {
    host.textContent = 'No Navin surfaces are available for this session.'
    return
  }

  let activeId: string | null = null

  const activate = async (id: string): Promise<void> => {
    if (activeId === id) return
    const surfaceModule = await loadSurfaceModule(id, entitlements)
    host.replaceChildren()
    await surfaceModule.mount(host, { surface: surfaceModule.id, channel, navindOrigin: null })
    activeId = id
    for (const button of nav.querySelectorAll('button')) {
      if (button.dataset.moduleId === id) {
        button.setAttribute('aria-current', 'page')
      } else {
        button.removeAttribute('aria-current')
      }
    }
  }

  for (const contribution of modules) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'navin-nav-button'
    button.textContent = contribution.label
    button.dataset.moduleId = contribution.id
    button.addEventListener('click', () => {
      void activate(contribution.id)
    })
    nav.append(button)
  }

  const initial = defaultModule(entitlements)
  if (initial !== null) await activate(initial)
}

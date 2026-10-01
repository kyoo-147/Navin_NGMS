import { parseDeepLink } from './deep-link'
import { normalizeNotification } from './notification'
import { createUnavailableSecretStore } from './secrets'
import type {
  AdapterBundle,
  DeepLinkAdapter,
  FileDialogAdapter,
  NotificationAdapter,
  UpdateAdapter,
} from './types'

function webDeepLinkUrls(): readonly string[] {
  if (typeof window === 'undefined') return []
  const urls: string[] = []
  const fromQuery = new URLSearchParams(window.location.search).get('deep_link')
  if (fromQuery !== null) urls.push(fromQuery)
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  if (hash !== '') {
    for (const part of hash.split('&')) {
      const candidate = decodeURIComponent(part)
      if (candidate !== '') urls.push(candidate)
    }
  }
  const accepted: string[] = []
  for (const candidate of urls) {
    try {
      parseDeepLink(candidate)
      accepted.push(candidate)
    } catch {
      // Untrusted URLs that fail the deep-link policy are silently ignored.
    }
  }
  return accepted
}

/**
 * Browser fallback bundle. There is no OS keychain in a plain browser, so secret
 * storage is explicitly unavailable (never a plaintext web-storage fallback);
 * native-only affordances degrade to a supported=false boundary.
 */
export function createWebFallbackAdapters(): AdapterBundle {
  const deepLinks: DeepLinkAdapter = {
    async subscribe(handler) {
      if (typeof window === 'undefined') return () => undefined
      const onNavigate = (): void => {
        for (const url of webDeepLinkUrls()) handler(url)
      }
      window.addEventListener('popstate', onNavigate)
      window.addEventListener('hashchange', onNavigate)
      return () => {
        window.removeEventListener('popstate', onNavigate)
        window.removeEventListener('hashchange', onNavigate)
      }
    },
    async initialUrls() {
      return webDeepLinkUrls()
    },
  }

  const fileDialog: FileDialogAdapter = {
    supported: false,
    async open() {
      return null
    },
    async save() {
      return null
    },
  }

  const notifications: NotificationAdapter = {
    async isGranted() {
      return typeof Notification !== 'undefined' && Notification.permission === 'granted'
    },
    async requestPermission() {
      if (typeof Notification === 'undefined') return false
      if (Notification.permission === 'granted') return true
      return (await Notification.requestPermission()) === 'granted'
    },
    async notify(input) {
      const normalized = normalizeNotification(input)
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        throw new Error('web notifications are not permitted')
      }
      void new Notification(
        normalized.title,
        normalized.body === undefined ? {} : { body: normalized.body },
      )
    },
  }

  const updates: UpdateAdapter = {
    enabled: false,
    async check() {
      return { status: 'disabled', version: null }
    },
  }

  return {
    platform: 'web',
    secrets: createUnavailableSecretStore(),
    deepLinks,
    fileDialog,
    notifications,
    updates,
  }
}

import { setNativeTransport } from '../ipc/bridge'
import { normalizeFileDialogOptions } from './file-dialog'
import { normalizeNotification } from './notification'
import { createNativeSecretStore } from './secrets'
import type {
  AdapterBundle,
  DeepLinkAdapter,
  FileDialogAdapter,
  FileDialogOptions,
  NotificationAdapter,
  NotificationInput,
  UpdateAdapter,
} from './types'

export interface NativeUpdaterDeps {
  readonly enabled: boolean
  check(): Promise<string | null>
}

export interface NativeBridgeDeps {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  deepLinks: {
    subscribe(handler: (url: string) => void): Promise<() => void>
    current(): Promise<readonly string[]>
  }
  fileDialog: {
    open(options: FileDialogOptions): Promise<string | null>
    save(options: FileDialogOptions): Promise<string | null>
  }
  notifications: {
    isGranted(): Promise<boolean>
    request(): Promise<boolean>
    send(input: NotificationInput): Promise<void>
  }
  updater: NativeUpdaterDeps
}

/**
 * Build the native adapter bundle from injected plugin functions. Kept free of
 * `@tauri-apps/*` imports so the policy and wiring can be unit-tested with fakes;
 * the concrete plugin imports live in `native/tauri-bindings.ts`.
 */
export function createNativeAdapters(deps: NativeBridgeDeps): AdapterBundle {
  setNativeTransport({ invoke: deps.invoke })

  const deepLinks: DeepLinkAdapter = {
    subscribe: (handler) => deps.deepLinks.subscribe(handler),
    initialUrls: () => deps.deepLinks.current(),
  }

  const fileDialog: FileDialogAdapter = {
    supported: true,
    open: (options) => deps.fileDialog.open(normalizeFileDialogOptions(options)),
    save: (options) => deps.fileDialog.save(normalizeFileDialogOptions(options)),
  }

  const notifications: NotificationAdapter = {
    isGranted: () => deps.notifications.isGranted(),
    requestPermission: () => deps.notifications.request(),
    notify: (input) => deps.notifications.send(normalizeNotification(input)),
  }

  const updates: UpdateAdapter = {
    enabled: deps.updater.enabled,
    async check() {
      if (!deps.updater.enabled) return { status: 'disabled', version: null }
      const version = await deps.updater.check()
      return version === null
        ? { status: 'up-to-date', version: null }
        : { status: 'available', version }
    },
  }

  return {
    platform: 'tauri',
    secrets: createNativeSecretStore(),
    deepLinks,
    fileDialog,
    notifications,
    updates,
  }
}

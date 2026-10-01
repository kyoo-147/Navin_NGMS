import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { check as checkForUpdate } from '@tauri-apps/plugin-updater'
import { setAdapters } from '../adapters'
import { createNativeAdapters } from '../adapters/native'
import type { FileDialogOptions, NotificationInput } from '../adapters/types'

export interface NativeInstallOptions {
  readonly updaterEnabled: boolean
}

function toDialogOptions(options: FileDialogOptions): {
  title?: string
  filters?: { name: string; extensions: string[] }[]
} {
  return {
    title: options.title,
    filters: options.filters?.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  }
}

/**
 * The only module that touches the `@tauri-apps/*` plugin runtime. It wires the
 * official plugins into the injectable native adapter bundle and installs the
 * native IPC transport used by the allowlist bridge.
 */
export function installNativeAdapters(options: NativeInstallOptions): void {
  const bundle = createNativeAdapters({
    invoke: (command, args) => tauriInvoke(command, args),
    deepLinks: {
      subscribe: (handler) =>
        onOpenUrl((urls) => {
          for (const url of urls) handler(url)
        }),
      current: async () => (await getCurrent()) ?? [],
    },
    fileDialog: {
      open: (dialogOptions) => openDialog(toDialogOptions(dialogOptions)),
      save: (dialogOptions) => saveDialog(toDialogOptions(dialogOptions)),
    },
    notifications: {
      isGranted: () => isPermissionGranted(),
      request: async () => (await requestPermission()) === 'granted',
      send: async (input: NotificationInput) => {
        await sendNotification(
          input.body === undefined
            ? { title: input.title }
            : { title: input.title, body: input.body },
        )
      },
    },
    updater: {
      enabled: options.updaterEnabled,
      check: async () => {
        const update = await checkForUpdate()
        return update?.version ?? null
      },
    },
  })

  setAdapters(bundle)
}

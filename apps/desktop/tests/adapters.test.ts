import { afterEach, describe, expect, it } from 'vitest'
import { getAdapters, resetAdapters } from '../src/shell/adapters'
import { normalizeFileDialogOptions } from '../src/shell/adapters/file-dialog'
import { createNativeAdapters, type NativeBridgeDeps } from '../src/shell/adapters/native'
import { normalizeNotification } from '../src/shell/adapters/notification'
import { createWebFallbackAdapters } from '../src/shell/adapters/web-fallback'
import { hasNativeTransport, setNativeTransport } from '../src/shell/ipc/bridge'

afterEach(() => {
  resetAdapters()
  setNativeTransport(null)
})

describe('web fallback adapters', () => {
  it('exposes no keychain, no updater and no native file dialog', async () => {
    const bundle = createWebFallbackAdapters()
    expect(bundle.platform).toBe('web')
    expect(bundle.secrets.kind).toBe('unavailable')
    expect(bundle.updates.enabled).toBe(false)
    expect(bundle.fileDialog.supported).toBe(false)
    expect(await bundle.updates.check()).toEqual({ status: 'disabled', version: null })
    expect(await bundle.fileDialog.open()).toBeNull()
  })
})

describe('native adapter factory', () => {
  it('installs the transport and validates dialog/notification input', async () => {
    const calls: string[] = []
    const invoke: NativeBridgeDeps['invoke'] = async (command) => {
      calls.push(command)
      return null as never
    }
    const bundle = createNativeAdapters({
      invoke,
      deepLinks: { subscribe: async () => () => undefined, current: async () => [] },
      fileDialog: {
        open: async (options) => (options.title === undefined ? null : options.title),
        save: async () => null,
      },
      notifications: {
        isGranted: async () => true,
        request: async () => true,
        send: async (input) => {
          calls.push(`notify:${input.title}`)
        },
      },
      updater: { enabled: false, check: async () => null },
    })

    expect(hasNativeTransport()).toBe(true)
    expect(bundle.platform).toBe('tauri')
    expect(bundle.secrets.kind).toBe('os-keychain')
    expect(bundle.secrets.persistent).toBe(true)
    expect(await bundle.fileDialog.open({ title: 'Save key' })).toBe('Save key')
    await bundle.notifications.notify({ title: 'Hi' })
    expect(calls).toContain('notify:Hi')
    expect(await bundle.updates.check()).toEqual({ status: 'disabled', version: null })
  })
})

describe('adapter input validation', () => {
  it('rejects unsafe file filter extensions', () => {
    expect(() =>
      normalizeFileDialogOptions({ filters: [{ name: 'Keys', extensions: ['../etc'] }] }),
    ).toThrow()
  })

  it('bounds notification content', () => {
    expect(() => normalizeNotification({ title: '' })).toThrow()
    expect(normalizeNotification({ title: '  Hello  ' }).title).toBe('Hello')
  })
})

describe('adapter registry default', () => {
  it('falls back to the web bundle when nothing is installed', () => {
    resetAdapters()
    expect(getAdapters().platform).toBe('web')
  })
})

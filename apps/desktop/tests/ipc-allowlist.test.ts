import { describe, expect, it } from 'vitest'
import { IpcNotAllowedError, NativeBridgeUnavailableError } from '../src/shell/errors'
import { assertAllowedCommand, ipcAllowlist, isAllowedCommand } from '../src/shell/ipc/allowlist'
import {
  hasNativeTransport,
  invokeNative,
  setNativeTransport,
  type NativeTransport,
} from '../src/shell/ipc/bridge'

describe('narrow IPC allowlist', () => {
  it('parses the shared allowlist', () => {
    expect(ipcAllowlist.version).toBeGreaterThanOrEqual(1)
    expect(ipcAllowlist.commands).toContain('navin_shell_info')
    expect(ipcAllowlist.commands.every((command) => command.startsWith('navin_'))).toBe(true)
  })

  it('denies unknown commands by default', () => {
    expect(isAllowedCommand('fs_read_file')).toBe(false)
    expect(isAllowedCommand('')).toBe(false)
    expect(() => assertAllowedCommand('fs_read_file')).toThrow(IpcNotAllowedError)
  })
})

describe('IPC bridge fails closed', () => {
  it('refuses to invoke without a native transport', async () => {
    setNativeTransport(null)
    expect(hasNativeTransport()).toBe(false)
    await expect(invokeNative('navin_shell_info')).rejects.toBeInstanceOf(
      NativeBridgeUnavailableError,
    )
  })

  it('rejects non-allowlisted commands before touching the transport', async () => {
    let called = false
    const invoke: NativeTransport['invoke'] = async () => {
      called = true
      return null as never
    }
    setNativeTransport({ invoke })
    await expect(invokeNative('evil_command')).rejects.toBeInstanceOf(IpcNotAllowedError)
    expect(called).toBe(false)
    setNativeTransport(null)
  })

  it('forwards allowlisted commands to the transport', async () => {
    const calls: string[] = []
    const invoke: NativeTransport['invoke'] = async (command) => {
      calls.push(command)
      return { ok: true } as never
    }
    setNativeTransport({ invoke })
    const result = await invokeNative<{ ok: boolean }>('navin_shell_info')
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(['navin_shell_info'])
    setNativeTransport(null)
  })
})

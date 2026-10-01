import { NativeBridgeUnavailableError } from '../errors'
import { assertAllowedCommand } from './allowlist'

export interface NativeTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

let transport: NativeTransport | null = null

/**
 * The native transport is injected by the Tauri binding at startup. Keeping it
 * behind this seam means every renderer call is checked against the allowlist
 * before it can reach Rust, and tests can run without the Tauri runtime.
 */
export function setNativeTransport(next: NativeTransport | null): void {
  transport = next
}

export function hasNativeTransport(): boolean {
  return transport !== null
}

export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  assertAllowedCommand(command)
  if (transport === null) {
    throw new NativeBridgeUnavailableError(command)
  }
  return transport.invoke<T>(command, args)
}

import { resolveUpdatePolicy, type UpdatePolicy, type UpdatePolicyInput } from './adapters/update'

export interface DesktopConfig {
  readonly updater: UpdatePolicy
}

/**
 * Default renderer build config. The updater is disabled and must declare no
 * endpoints, pubkey or hosts, matching the fail-closed Tauri config. Enabling it
 * requires an explicit, signed, HTTPS-only, allow-listed configuration.
 */
export const DEFAULT_UPDATER_INPUT: UpdatePolicyInput = {
  enabled: false,
  endpoints: [],
  pubkey: '',
  allowHosts: [],
}

export function resolveDesktopConfig(
  updater: UpdatePolicyInput = DEFAULT_UPDATER_INPUT,
): DesktopConfig {
  return { updater: resolveUpdatePolicy(updater) }
}

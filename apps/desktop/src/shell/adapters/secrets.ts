import { SecretStorageUnavailableError } from '../errors'
import { invokeNative } from '../ipc/bridge'
import type { SecretRef, SecretStoreAdapter } from './types'

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u

export function assertSecretRef(ref: SecretRef): void {
  if (!NAMESPACE_PATTERN.test(ref.namespace)) {
    throw new Error(`invalid secret namespace "${ref.namespace}"`)
  }
  if (!NAME_PATTERN.test(ref.name)) {
    throw new Error(`invalid secret name "${ref.name}"`)
  }
}

export function secretId(ref: SecretRef): string {
  assertSecretRef(ref)
  return `${ref.namespace}/${ref.name}`
}

/** OS keychain store. Talks only to the allowlisted native secret commands. */
export function createNativeSecretStore(): SecretStoreAdapter {
  return {
    kind: 'os-keychain',
    persistent: true,
    async store(ref, value) {
      assertSecretRef(ref)
      await invokeNative('navin_secret_store', {
        namespace: ref.namespace,
        name: ref.name,
        value,
      })
    },
    async retrieve(ref) {
      assertSecretRef(ref)
      const value = await invokeNative<string | null>('navin_secret_retrieve', {
        namespace: ref.namespace,
        name: ref.name,
      })
      return value ?? null
    },
    async remove(ref) {
      assertSecretRef(ref)
      await invokeNative('navin_secret_delete', {
        namespace: ref.namespace,
        name: ref.name,
      })
    },
  }
}

/**
 * Explicitly unavailable secret storage. This is the web-fallback default and
 * exists so there is never a plaintext-on-disk path: the shell fails closed
 * rather than writing secrets to localStorage, files or cookies.
 */
export function createUnavailableSecretStore(): SecretStoreAdapter {
  const reject = (): Promise<never> => Promise.reject(new SecretStorageUnavailableError('persist'))
  return {
    kind: 'unavailable',
    persistent: false,
    store: reject,
    retrieve: reject,
    remove: reject,
  }
}

/** Non-persistent in-memory store used by tests and ephemeral smoke runs. */
export function createMemorySecretStore(): SecretStoreAdapter {
  const values = new Map<string, string>()
  return {
    kind: 'memory',
    persistent: false,
    async store(ref, value) {
      values.set(secretId(ref), value)
    },
    async retrieve(ref) {
      return values.get(secretId(ref)) ?? null
    },
    async remove(ref) {
      values.delete(secretId(ref))
    },
  }
}

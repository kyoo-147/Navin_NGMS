import { describe, expect, it } from 'vitest'
import {
  createMemorySecretStore,
  createUnavailableSecretStore,
  secretId,
} from '../src/shell/adapters/secrets'
import { SecretStorageUnavailableError } from '../src/shell/errors'

describe('secret storage policy', () => {
  it('rejects malformed references', () => {
    expect(() => secretId({ namespace: '', name: 'token' })).toThrow()
    expect(() => secretId({ namespace: 'Navin', name: 'token' })).toThrow()
    expect(() => secretId({ namespace: 'navin', name: '../escape' })).toThrow()
  })

  it('never falls back to plaintext when the OS keychain is unavailable', async () => {
    const store = createUnavailableSecretStore()
    expect(store.kind).toBe('unavailable')
    expect(store.persistent).toBe(false)
    await expect(
      store.store({ namespace: 'navin', name: 'token' }, 'secret'),
    ).rejects.toBeInstanceOf(SecretStorageUnavailableError)
    await expect(store.retrieve({ namespace: 'navin', name: 'token' })).rejects.toBeInstanceOf(
      SecretStorageUnavailableError,
    )
    await expect(store.remove({ namespace: 'navin', name: 'token' })).rejects.toBeInstanceOf(
      SecretStorageUnavailableError,
    )
  })

  it('supports an explicitly non-persistent in-memory store', async () => {
    const store = createMemorySecretStore()
    const ref = { namespace: 'navin', name: 'token' }
    expect(store.persistent).toBe(false)
    await store.store(ref, 'value')
    expect(await store.retrieve(ref)).toBe('value')
    await store.remove(ref)
    expect(await store.retrieve(ref)).toBeNull()
  })
})

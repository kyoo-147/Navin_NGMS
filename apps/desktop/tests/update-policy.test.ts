import { describe, expect, it } from 'vitest'
import { resolveUpdatePolicy } from '../src/shell/adapters/update'
import { UpdatePolicyError } from '../src/shell/errors'

describe('fail-closed updater policy', () => {
  it('keeps the updater disabled and empty by default', () => {
    const policy = resolveUpdatePolicy({
      enabled: false,
      endpoints: [],
      pubkey: '',
      allowHosts: [],
    })
    expect(policy).toEqual({ enabled: false, endpoints: [], allowHosts: [] })
  })

  it('rejects a disabled updater that still carries configuration', () => {
    expect(() =>
      resolveUpdatePolicy({
        enabled: false,
        endpoints: ['https://updates.example.com'],
        pubkey: '',
        allowHosts: [],
      }),
    ).toThrow(UpdatePolicyError)
  })

  it('requires a signature, HTTPS and an allowlisted host when enabled', () => {
    expect(() =>
      resolveUpdatePolicy({
        enabled: true,
        endpoints: ['https://updates.example.com'],
        pubkey: '',
        allowHosts: ['updates.example.com'],
      }),
    ).toThrow(UpdatePolicyError)
    expect(() =>
      resolveUpdatePolicy({
        enabled: true,
        endpoints: ['http://updates.example.com'],
        pubkey: 'key',
        allowHosts: ['updates.example.com'],
      }),
    ).toThrow(UpdatePolicyError)
    expect(() =>
      resolveUpdatePolicy({
        enabled: true,
        endpoints: ['https://user:pass@updates.example.com'],
        pubkey: 'key',
        allowHosts: ['updates.example.com'],
      }),
    ).toThrow(UpdatePolicyError)
    expect(() =>
      resolveUpdatePolicy({
        enabled: true,
        endpoints: ['https://evil.example'],
        pubkey: 'key',
        allowHosts: ['updates.example.com'],
      }),
    ).toThrow(UpdatePolicyError)
  })

  it('accepts a fully specified signed HTTPS config', () => {
    const policy = resolveUpdatePolicy({
      enabled: true,
      endpoints: ['https://updates.example.com/stable/'],
      pubkey: 'key',
      allowHosts: ['updates.example.com'],
    })
    expect(policy.enabled).toBe(true)
    expect(policy.endpoints).toEqual(['https://updates.example.com/stable/'])
  })
})

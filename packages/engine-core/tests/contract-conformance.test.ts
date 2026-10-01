import { describe, it, expect } from 'vitest'
import {
  EngineAdapterDescriptorSchema,
  NavinErrorSchema,
  isValid,
  type EngineAdapterDescriptor,
  type NavinError,
} from '@navin/contracts'
import { EngineError, toNavinError } from '../src/index.js'
import { StalwartEngineAdapter } from '../src/stalwart/index.js'

describe('frozen contract conformance', () => {
  it('produces an EngineAdapterDescriptor the frozen contracts schema accepts', () => {
    const adapter = new StalwartEngineAdapter({
      endpoint: 'http://127.0.0.1:18080',
      token: 'navin-test-token',
      engineVersion: '0.16.24',
    })

    const descriptor: EngineAdapterDescriptor = adapter.descriptor

    expect(descriptor.engineId).toBe('stalwart')
    expect(descriptor.connection?.secure).toBe(false)
    expect(isValid(EngineAdapterDescriptorSchema, descriptor)).toBe(true)
  })

  it('maps normalized engine errors into the frozen NavinError envelope', () => {
    const envelope: NavinError = toNavinError(
      new EngineError({ category: 'unavailable', message: 'engine down', requestId: 'req-1' }),
      { surface: 'control' },
    )

    expect(isValid(NavinErrorSchema, envelope)).toBe(true)
    expect(envelope.code).toBe('SERVICE_UNAVAILABLE')
    expect(envelope.retryable).toBe(true)
    expect(envelope.requestId).toBe('req-1')
  })
})

import { describe, expect, it } from 'vitest'
import endpointCorpus from '../src/shell/navind/endpoint-corpus.json'
import { EndpointPolicyError } from '../src/shell/errors'
import { baseUrlOf, isLoopbackHost, parseNavindEndpoint } from '../src/shell/navind/endpoint'

describe('navind endpoint policy', () => {
  it('matches the shared TypeScript/Rust acceptance corpus', () => {
    for (const testCase of endpointCorpus) {
      let parsed: ReturnType<typeof parseNavindEndpoint> | null = null
      try {
        parsed = parseNavindEndpoint(testCase.input)
      } catch {
        parsed = null
      }
      expect(parsed !== null, testCase.input).toBe(testCase.accepted)
      if (parsed !== null && testCase.accepted) {
        expect(parsed.origin, testCase.input).toBe(testCase.origin)
        expect(parsed.pathPrefix, testCase.input).toBe(testCase.pathPrefix)
        expect(parsed.scheme, testCase.input).toBe(testCase.scheme)
        expect(parsed.host, testCase.input).toBe(testCase.host)
        expect(parsed.isLoopback, testCase.input).toBe(testCase.isLoopback)
      }
    }
  })

  it('accepts HTTPS remote endpoints and normalizes the path', () => {
    const endpoint = parseNavindEndpoint('https://mail.example.com:8443/navin/')
    expect(endpoint.scheme).toBe('https')
    expect(endpoint.origin).toBe('https://mail.example.com:8443')
    expect(baseUrlOf(endpoint)).toBe('https://mail.example.com:8443/navin')
    expect(endpoint.isLoopback).toBe(false)
  })

  it('allows plaintext only on loopback', () => {
    expect(isLoopbackHost('localhost')).toBe(false)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(parseNavindEndpoint('http://127.0.0.1:8082').isLoopback).toBe(true)
    expect(() => parseNavindEndpoint('http://mail.example.com')).toThrow(EndpointPolicyError)
    expect(() => parseNavindEndpoint('http://10.0.0.5:8082')).toThrow(EndpointPolicyError)
  })

  it('rejects credentials, downgrade attempts and malformed URLs', () => {
    expect(() => parseNavindEndpoint('https://user:pass@mail.example.com')).toThrow(
      EndpointPolicyError,
    )
    expect(() => parseNavindEndpoint('ws://mail.example.com')).toThrow(EndpointPolicyError)
    expect(() => parseNavindEndpoint('https://mail.example.com/?x=1')).toThrow(EndpointPolicyError)
    expect(() => parseNavindEndpoint('mail.example.com')).toThrow(EndpointPolicyError)
  })
})

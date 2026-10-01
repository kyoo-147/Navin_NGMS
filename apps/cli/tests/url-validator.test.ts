import { describe, expect, it } from 'vitest'

import { assertSafeApiUrlForToken } from '../src/url-validator.js'

describe('CLI API URL policy', () => {
  it.each([
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'https://control.example.com',
    'https://control.example.com/api/v1',
  ])('accepts safe endpoint %s', (endpoint) => {
    expect(() => assertSafeApiUrlForToken(endpoint)).not.toThrow()
  })

  it.each([
    'http://localhost:3000',
    'http://127.1:3000',
    'http://2130706433:3000',
    'http://0177.0.0.1:3000',
    'http://10.0.0.1:3000',
    'http://user:password@127.0.0.1:3000',
    'http://127.0.0.1:3000?token=value',
    'http://127.0.0.1:3000#fragment',
    'http://127.0.0.1:3000/%2fadmin',
    'http://127.0.0.1:3000/%5cadmin',
    'http://127.0.0.1:3000/../admin',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => assertSafeApiUrlForToken(endpoint)).toThrow(/Insecure API URL/)
  })
})

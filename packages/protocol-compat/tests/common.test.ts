import { describe, it, expect } from 'vitest'
import { ProtocolError, isProtocolError, normalizeError } from '../src/common/errors.js'
import { DEFAULT_PROTOCOL_LIMITS, resolveLimits } from '../src/common/limits.js'
import {
  base64Decode,
  encodeLoginPassword,
  encodeLoginUsername,
  encodePlain,
  encodeXoauth2,
  isTokenCredentials,
  type SaslCredentials,
} from '../src/common/sasl.js'
import { assertNoControlBytes, formatMailbox } from '../src/common/address.js'
import { buildMessage } from '../src/smtp/message.js'

describe('normalized protocol errors', () => {
  it('maps an auth failure onto the platform error envelope', () => {
    const error = new ProtocolError('AUTH_FAILED', 'bad password', { protocol: 'imap' })
    const normalized = error.toNormalizedError()
    expect(normalized.code).toBe('UNAUTHORIZED')
    expect(normalized.retryable).toBe(false)
    expect(normalized.details.protocol).toBe('imap')
    expect(normalized.details.protocolCode).toBe('AUTH_FAILED')
    expect(new Date(normalized.timestamp).toString()).not.toBe('Invalid Date')
  })

  it('marks transport timeouts as retryable service unavailability', () => {
    const normalized = new ProtocolError('TIMEOUT', 'slow', {
      protocol: 'smtp',
    }).toNormalizedError()
    expect(normalized.code).toBe('SERVICE_UNAVAILABLE')
    expect(normalized.retryable).toBe(true)
  })

  it('recognizes protocol errors', () => {
    expect(isProtocolError(new ProtocolError('PROTOCOL_ERROR', 'x'))).toBe(true)
    expect(isProtocolError(new Error('x'))).toBe(false)
  })

  it('passes through an existing ProtocolError unchanged', () => {
    const original = new ProtocolError('LIMIT_EXCEEDED', 'too big')
    expect(normalizeError(original, { code: 'PROTOCOL_ERROR', protocol: 'imap' })).toBe(original)
  })

  it('translates common socket errno values', () => {
    const timeout = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    expect(normalizeError(timeout, { code: 'PROTOCOL_ERROR', protocol: 'transport' }).code).toBe(
      'TIMEOUT',
    )
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(normalizeError(refused, { code: 'PROTOCOL_ERROR', protocol: 'transport' }).code).toBe(
      'CONNECT_FAILED',
    )
  })

  it('falls back to the provided code for unknown errors', () => {
    const error = normalizeError(new Error('mystery'), {
      code: 'UNEXPECTED_RESPONSE',
      protocol: 'imap',
    })
    expect(error.code).toBe('UNEXPECTED_RESPONSE')
    expect(error.protocol).toBe('imap')
  })
})

describe('protocol limits', () => {
  it('merges overrides over the defaults', () => {
    const limits = resolveLimits({ maxLineBytes: 128 })
    expect(limits.maxLineBytes).toBe(128)
    expect(limits.commandTimeoutMs).toBe(DEFAULT_PROTOCOL_LIMITS.commandTimeoutMs)
  })

  it('rejects non-positive limits', () => {
    expect(() => resolveLimits({ commandTimeoutMs: 0 })).toThrowError(ProtocolError)
  })
})

describe('SASL encodings', () => {
  const passwordCredentials: SaslCredentials = {
    username: 'alice@example.test',
    password: 'secret',
  }
  const tokenCredentials: SaslCredentials = {
    username: 'alice@example.test',
    accessToken: 'tok-123',
  }

  it('encodes PLAIN as authzid NUL authcid NUL password', () => {
    const decoded = base64Decode(encodePlain(passwordCredentials)).toString('utf8')
    expect(decoded).toBe(['', 'alice@example.test', 'secret'].join(String.fromCharCode(0)))
  })

  it('encodes LOGIN username and password separately', () => {
    expect(base64Decode(encodeLoginUsername(passwordCredentials)).toString()).toBe(
      'alice@example.test',
    )
    expect(base64Decode(encodeLoginPassword(passwordCredentials)).toString()).toBe('secret')
  })

  it('encodes XOAUTH2 with the bearer token', () => {
    const decoded = base64Decode(encodeXoauth2(tokenCredentials)).toString('utf8')
    expect(decoded).toContain('user=alice@example.test')
    expect(decoded).toContain('auth=Bearer tok-123')
  })

  it('distinguishes token from password credentials', () => {
    expect(isTokenCredentials(tokenCredentials)).toBe(true)
    expect(isTokenCredentials(passwordCredentials)).toBe(false)
  })

  it('rejects PLAIN with token credentials', () => {
    expect(() => encodePlain(tokenCredentials)).toThrowError(ProtocolError)
  })
})

describe('address helpers', () => {
  it('formats an SMTP reverse/forward path in angle brackets', () => {
    expect(formatMailbox('alice@example.test')).toBe('<alice@example.test>')
  })

  it('rejects CRLF injection in addresses', () => {
    expect(() => assertNoControlBytes('a@b\r\nRCPT TO:<x>', 'address')).toThrowError(ProtocolError)
    expect(() => formatMailbox('bad>address')).toThrowError(ProtocolError)
  })
})

describe('MIME wire boundaries', () => {
  it('rejects control bytes in MIME boundaries and header names', () => {
    const base = {
      from: 'alice@example.test',
      to: ['bob@example.test'],
      subject: 'subject',
      text: 'body',
    }
    expect(() => buildMessage({ ...base, boundary: `safe\r\nX: leak` })).toThrowError(ProtocolError)
    expect(() => buildMessage({ ...base, headers: { 'X-Test\0Inject': 'value' } })).toThrowError(
      ProtocolError,
    )
  })
})

import { describe, expect, it } from 'vitest'
import { REDACTED, redactRecord, redactUnknown } from '../src/redaction.js'

describe('secret redaction', () => {
  it('redacts secret-bearing keys', () => {
    const redacted = redactRecord({
      email: 'operator@example.com',
      password: 'hunter2',
      passwordHash: 'scrypt$...',
      token: 'abc.def.ghi',
      tokenHash: 'deadbeef',
      csrfSecret: 'zzz',
      authorization: 'Bearer xyz',
      cookie: '__Host-navin=...',
      apiKey: 'sk-live',
      sessionId: 'ses_1',
    })
    expect(redacted.email).toBe('operator@example.com')
    expect(redacted.sessionId).toBe('ses_1')
    for (const key of [
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'csrfSecret',
      'authorization',
      'cookie',
      'apiKey',
    ]) {
      expect(redacted[key]).toBe(REDACTED)
    }
  })

  it('redacts nested structures and byte sequences', () => {
    const redacted = redactUnknown({
      principal: { email: 'a@b.com', scopes: ['mail:read'] },
      sessions: [{ token: 'secret', note: 'ok' }],
      key: new Uint8Array([1, 2, 3]),
    }) as Record<string, unknown>
    expect((redacted.principal as Record<string, unknown>).email).toBe('a@b.com')
    expect(((redacted.sessions as unknown[])[0] as Record<string, unknown>).token).toBe(REDACTED)
    expect(((redacted.sessions as unknown[])[0] as Record<string, unknown>).note).toBe('ok')
    expect(redacted.key).toBe(REDACTED)
  })

  it('does not mutate the original record', () => {
    const original = { password: 'hunter2', email: 'a@b.com' }
    const redacted = redactRecord(original)
    expect(original.password).toBe('hunter2')
    expect(redacted).not.toBe(original)
  })
})

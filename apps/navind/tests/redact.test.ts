import { describe, expect, it } from 'vitest'
import { REDACTED, isSensitiveKey, redactText, redactValue } from '../src/logging/redact.js'

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('isSensitiveKey', () => {
  it('flags known secret markers', () => {
    for (const key of [
      'password',
      'userPassword',
      'passwd',
      'sessionSecret',
      'encryptionKey',
      'apiKey',
      'api_key',
      'accessToken',
      'authorization',
      'cookie',
      'credential',
      'privateKey',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
  })

  it('leaves ordinary keys alone', () => {
    for (const key of ['host', 'port', 'username', 'count', 'environment', 'msg']) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })
})

describe('redactText', () => {
  it('masks bearer, basic and JWT credentials', () => {
    const bearer = redactText('Authorization: Bearer abc.def.ghi')
    expect(bearer).not.toContain('abc.def.ghi')
    expect(bearer).toContain(REDACTED)

    expect(redactText('Authorization: Basic dXNlcjpwYXNzd29yZA==')).not.toContain(
      'dXNlcjpwYXNzd29yZA==',
    )
    expect(redactText(`token ${SAMPLE_JWT}`)).not.toContain(SAMPLE_JWT)
    expect(redactText(`token ${SAMPLE_JWT}`)).toContain(REDACTED)
  })

  it('masks secret assignment values', () => {
    expect(redactText('password=hunter2')).toBe(`password=${REDACTED}`)
    expect(redactText('api_key: "abc123"')).not.toContain('abc123')
    expect(redactText('secret: hunter2')).not.toContain('hunter2')
  })

  it('masks registered literals anywhere in the text', () => {
    const result = redactText('note super-secret-value leaked', ['super-secret-value'])
    expect(result).not.toContain('super-secret-value')
    expect(result).toContain(REDACTED)
  })

  it('leaves ordinary text untouched', () => {
    expect(redactText('migrations applied')).toBe('migrations applied')
  })
})

describe('redactValue', () => {
  it('masks sensitive fields at every depth', () => {
    const result = redactValue({
      host: '127.0.0.1',
      password: 'hunter2',
      nested: { token: 'abc', keep: true },
      list: [{ secret: 'x' }],
    }) as Record<string, unknown>

    expect(result.host).toBe('127.0.0.1')
    expect(result.password).toBe(REDACTED)
    expect((result.nested as Record<string, unknown>).token).toBe(REDACTED)
    expect((result.nested as Record<string, unknown>).keep).toBe(true)
    expect(((result.list as Record<string, unknown>[])[0] as Record<string, unknown>).secret).toBe(
      REDACTED,
    )
  })

  it('masks embedded credentials and registered literals in strings and errors', () => {
    const secret = 'super-secret-value'
    const result = redactValue(
      {
        note: `leaked ${secret}`,
        header: 'Authorization: Bearer abc.def.ghi',
        err: new Error(`failure password=hunter2 for ${secret}`),
      },
      { literals: [secret] },
    ) as Record<string, unknown>

    const dumped = JSON.stringify(result)
    expect(dumped).not.toContain(secret)
    expect(dumped).not.toContain('hunter2')
    expect(dumped).not.toContain('abc.def.ghi')

    const error = result.err as Record<string, unknown>
    expect(String(error.message)).not.toContain(secret)
    expect(String(error.stack)).not.toContain(secret)
  })

  it('does not mask when redaction is disabled', () => {
    const result = redactValue({ password: 'hunter2' }, { redact: false }) as Record<
      string,
      unknown
    >
    expect(result.password).toBe('hunter2')
  })

  it('normalizes circular references, dates, bigints and errors', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic

    const result = redactValue({
      cyclic,
      when: new Date('2026-10-01T00:00:00.000Z'),
      big: 10n,
      err: new Error('boom'),
    }) as Record<string, unknown>

    expect((result.cyclic as Record<string, unknown>).self).toBe('[circular]')
    expect(result.when).toBe('2026-10-01T00:00:00.000Z')
    expect(result.big).toBe('10')
    expect((result.err as Record<string, unknown>).message).toBe('boom')
  })
})

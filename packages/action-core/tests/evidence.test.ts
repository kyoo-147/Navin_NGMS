import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, REDACTED } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

const RECEIPT = `sha256:${'a'.repeat(64)}`

describe('append-only redacted evidence ledger', () => {
  let dir: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    core = openCore(dir)
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  it('redacts secrets before persistence', () => {
    const record = core.evidence.append({
      checkType: 'smtp_auth',
      status: 'passed',
      target: 'mail.example.com',
      collector: 'navind.smtp',
      details: {
        username: 'ops@example.com',
        password: 'hunter2',
        nested: { apiKey: 'sk-live-123' },
      },
      rawOutputRedacted: 'Authorization: Bearer supersecrettokenvalue',
    })

    expect(record.details.password).toBe(REDACTED)
    expect((record.details.nested as Record<string, unknown>).apiKey).toBe(REDACTED)
    expect(record.rawOutputRedacted).toBe(REDACTED)

    const row = core.db
      .prepare('SELECT details, raw_output_redacted FROM evidence WHERE id = ?')
      .get(record.id) as { details: string; raw_output_redacted: string }
    expect(row.details).not.toContain('hunter2')
    expect(row.details).not.toContain('sk-live-123')
    expect(row.raw_output_redacted).not.toContain('supersecret')
  })

  it('computes and verifies a sha256 digest over the redacted content', () => {
    const record = core.evidence.append({
      checkType: 'dns_spf',
      status: 'passed',
      target: 'example.com',
      collector: 'navind.dns',
      details: { record: 'v=spf1 mx ~all', receipt: RECEIPT },
      rawOutputRedacted: 'v=spf1 mx ~all',
    })
    expect(record.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(core.evidence.verifyDigest(record.id)).toBe(true)
  })

  it('rejects a caller-supplied digest that does not match', () => {
    expect(() =>
      core.evidence.append({
        checkType: 'dns_spf',
        status: 'passed',
        target: 'example.com',
        collector: 'navind.dns',
        details: { record: 'v=spf1 ~all', receipt: RECEIPT },
        rawOutputRedacted: 'v=spf1 ~all',
        digest: `sha256:${'0'.repeat(64)}`,
      }),
    ).toThrowError(/digest does not match/)
  })

  it('is append-only: updates and deletes are rejected at the database level', () => {
    const record = core.evidence.append({
      checkType: 'tls_cert_valid',
      status: 'passed',
      target: 'mail.example.com',
      collector: 'navind.tls',
      details: { receipt: RECEIPT },
      rawOutputRedacted: 'notAfter=2027-01-01T00:00:00Z',
    })
    expect(() =>
      core.db.prepare('UPDATE evidence SET status = ? WHERE id = ?').run('failed', record.id),
    ).toThrowError(/append-only/)
    expect(() => core.db.prepare('DELETE FROM evidence WHERE id = ?').run(record.id)).toThrowError(
      /append-only/,
    )
    expect(core.evidence.get(record.id)?.status).toBe('passed')
  })

  it('lists and filters evidence records', () => {
    core.evidence.append({
      checkType: 'dns_spf',
      status: 'passed',
      target: 'a.example.com',
      collector: 'navind.dns',
      details: { receipt: RECEIPT },
      rawOutputRedacted: 'a.example.com SPF v=spf1',
    })
    core.evidence.append({
      checkType: 'dns_dkim',
      status: 'warning',
      target: 'b.example.com',
      collector: 'navind.dns',
    })
    expect(core.evidence.list({ checkType: 'dns_spf' })).toHaveLength(1)
    expect(core.evidence.list({ status: 'warning' })).toHaveLength(1)
    expect(core.evidence.list({ target: 'a.example.com' })).toHaveLength(1)
    expect(core.evidence.list()).toHaveLength(2)
  })

  it('refuses to admit an arbitrary PASS row without verifier output', () => {
    expect(() =>
      core.evidence.append({
        checkType: 'dns_spf',
        status: 'passed',
        target: 'example.com',
        collector: 'navind.dns',
        details: {},
      }),
    ).toThrowError(/requires non-empty output/)

    expect(() =>
      core.evidence.append({
        checkType: 'dns_spf',
        status: 'passed',
        target: 'example.com',
        collector: 'navind.dns',
        details: { record: 'v=spf1 ~all' },
      }),
    ).toThrowError(/requires non-empty output/)

    // Non-PASS outcomes are admitted without a receipt.
    const warning = core.evidence.append({
      checkType: 'dns_dkim',
      status: 'warning',
      target: 'example.com',
      collector: 'navind.dns',
      details: {},
    })
    expect(warning.status).toBe('warning')
  })

  it('admits a PASS row backed by redacted raw output', () => {
    const record = core.evidence.append({
      checkType: 'tls_cert_valid',
      status: 'passed',
      target: 'mail.example.com',
      collector: 'navind.tls',
      rawOutputRedacted: 'notAfter=2027-01-01T00:00:00Z',
    })
    expect(record.status).toBe('passed')
  })
})

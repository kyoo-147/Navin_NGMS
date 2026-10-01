import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  GatewayError,
  InMemoryIdempotencyStore,
  SqliteIdempotencyStore,
  runIdempotent,
  sanitizeEmailHtml,
  validateAndResolveJmapSession,
  validateJmapUrl,
} from '../src/index.js'

const validSession = {
  apiUrl: '/jmap/api',
  uploadUrl: '/jmap/upload/{accountId}/',
  downloadUrl: '/jmap/download/{accountId}/{blobId}/{name}',
  eventSourceUrl: '/jmap/eventsource',
}

describe('W15 V2 URL and HTML hardening', () => {
  it.each([
    'http://example.org/jmap/session',
    'https://127.0.0.1/jmap/session',
    'https://10.0.0.1/jmap/session',
    'https://user:password@example.org/jmap/session',
    'https://example.org/jmap/session?redirect=1',
    'https://example.org/jmap/session#fragment',
    'https://example.org/jmap/../admin',
    'https://example.org/jmap/%2fadmin',
    'https://example.org/jmap//admin',
  ])('rejects SSRF and URL confusion input: %s', (url) => {
    expect(() => validateJmapUrl(url)).toThrow(GatewayError)
  })

  it('allows only literal loopback HTTP and preserves one origin for all session URLs', () => {
    const urls = validateAndResolveJmapSession('http://127.0.0.1:8080/jmap/session', validSession)
    expect(urls.apiUrl).toBe('http://127.0.0.1:8080/jmap/api')
    expect(() =>
      validateAndResolveJmapSession('https://example.org/jmap/session', {
        ...validSession,
        eventSourceUrl: 'https://other.example.org/events',
      }),
    ).toThrow(/origin-mismatch/i)
  })

  it('removes active HTML, event handlers, CSS and remote content', () => {
    const result = sanitizeEmailHtml(
      '<div onclick="alert(1)" style="background:url(https://tracker.invalid/x)">' +
        '<script>fetch("https://tracker.invalid")</script>' +
        '<img src="https://tracker.invalid/pixel" onerror="alert(1)">' +
        '<img src="cid:inline-1" alt="inline">' +
        '<a href="javascript:alert(1)">bad</a><a href="https://example.org">good</a>' +
        '<iframe src="https://example.org"></iframe></div>',
    )
    expect(result).not.toMatch(/script|iframe|onclick|onerror|tracker|javascript|style=/i)
    expect(result).toContain('cid:inline-1')
    expect(result).toContain('https://example.org')
  })

  it.each([
    '<scr<script>ipt>alert(1)</scr<script>ipt>',
    '<div><svg><script>alert(1)</script></svg><math><mi>x</mi></math></div>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<img srcset="https://tracker.invalid/x 1x" src="data:image/svg+xml,<svg/onload=alert(1)>">',
    '<div style="background:url(https://tracker.invalid/x)"><form><input></form></div>',
    '<a href="java&#x73;cript&#58;alert(1)">entity bypass</a>',
    '<img src="JaVaScRiPt:alert(1)" onerror="alert(1)">',
  ])('rejects adversarial HTML corpus: %s', (html) => {
    const sanitized = sanitizeEmailHtml(html).toLowerCase()
    expect(sanitized).not.toMatch(
      /<\/?(?:script|svg|math|iframe|form|input)|srcdoc\s*=|srcset\s*=|style\s*=|data:|javascript:|on[a-z]+\s*=/i,
    )
  })
})

describe('W15 V2 idempotency recovery', () => {
  it('reserves before producing and never caches a timeout as success', async () => {
    const store = new InMemoryIdempotencyStore()
    let produced = 0
    await expect(
      runIdempotent({
        store,
        scope: 'mutation:acc_example',
        key: 'timeout-1',
        fingerprint: 'same',
        produce: async () => {
          produced += 1
          throw new GatewayError({
            code: 'SERVICE_UNAVAILABLE',
            message: 'timeout',
            details: { reason: 'timeout' },
          })
        },
      }),
    ).rejects.toMatchObject({ details: { state: 'needs_attention' } })
    expect(produced).toBe(1)
    expect((await store.get('mutation:acc_example', 'timeout-1'))?.status).toBe('needs_attention')
    await expect(
      runIdempotent({
        store,
        scope: 'mutation:acc_example',
        key: 'timeout-1',
        fingerprint: 'same',
        produce: async () => 2,
      }),
    ).rejects.toMatchObject({ details: { state: 'needs_attention' } })
  })

  it('persists success and unknown pending outcomes across close and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mail-gateway-idempotency-'))
    const filename = join(directory, 'idempotency.sqlite')
    try {
      const first = new SqliteIdempotencyStore({ filename })
      const success = await runIdempotent({
        store: first,
        scope: 'submission:acc_example',
        key: 'restart-success',
        fingerprint: 'same',
        produce: async () => ({ accepted: true }),
      })
      expect(success.value).toEqual({ accepted: true })
      await first.reserve({
        scope: 'mutation:acc_example',
        key: 'restart-pending',
        fingerprint: 'pending-fingerprint',
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
      first.close()

      const reopened = new SqliteIdempotencyStore({ filename })
      await expect(
        runIdempotent({
          store: reopened,
          scope: 'submission:acc_example',
          key: 'restart-success',
          fingerprint: 'same',
          produce: async () => ({ accepted: false }),
        }),
      ).resolves.toMatchObject({ replayed: true, value: { accepted: true } })
      await expect(
        runIdempotent({
          store: reopened,
          scope: 'mutation:acc_example',
          key: 'restart-pending',
          fingerprint: 'pending-fingerprint',
          produce: async () => ({ shouldNotRun: true }),
        }),
      ).rejects.toMatchObject({ details: { state: 'needs_attention' } })
      reopened.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('atomically permits only one concurrent SQLite reservation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mail-gateway-idempotency-'))
    const filename = join(directory, 'idempotency.sqlite')
    const stores = [
      new SqliteIdempotencyStore({ filename }),
      new SqliteIdempotencyStore({ filename }),
    ]
    try {
      const record = (recordFingerprint: string) => ({
        scope: 'mutation:acc_example',
        key: 'concurrent',
        fingerprint: recordFingerprint,
        status: 'pending' as const,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      })
      const results = await Promise.all(
        stores.map((store, index) => store.reserve(record(`f${index}`))),
      )
      expect(results.filter((result) => result === null)).toHaveLength(1)
      expect(results.filter((result) => result !== null)).toHaveLength(1)
    } finally {
      for (const store of stores) store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails closed when the migration checksum is tampered with', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mail-gateway-idempotency-'))
    const filename = join(directory, 'idempotency.sqlite')
    try {
      const store = new SqliteIdempotencyStore({ filename })
      store.close()
      const database = new DatabaseSync(filename)
      database
        .prepare('UPDATE mail_gateway_schema_migrations SET checksum = ? WHERE version = 1')
        .run('tampered')
      database.close()
      expect(() => new SqliteIdempotencyStore({ filename })).toThrow(/checksum mismatch/i)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

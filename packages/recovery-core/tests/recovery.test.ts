import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FilesystemObjectStore,
  RecoveryCore,
  RecoveryJournal,
  S3CompatibleObjectStore,
  indexKey,
  manifestKey,
  objectKeyFor,
} from '../src/index.js'
import type { BackupRecord, KeyResolver, RestoreTargetPort } from '../src/index.js'

const bytes = (value: string) => new TextEncoder().encode(value)
const records: BackupRecord[] = [
  {
    id: 'account:alice',
    kind: 'account',
    content: bytes('{"address":"alice@example.com"}'),
    metadata: { version: 1 },
  },
  {
    id: 'thread:one',
    kind: 'thread',
    content: bytes('thread data'),
    metadata: { subject: 'fixture' },
  },
  {
    id: 'message:one',
    kind: 'raw-message',
    content: bytes('From: alice@example.com\r\n\r\nhello'),
    metadata: { flags: ['\\Seen'], labels: ['inbox'], date: '2026-01-01' },
  },
  {
    id: 'attachment:one',
    kind: 'attachment',
    content: bytes('attachment bytes'),
    metadata: { filename: 'note.txt' },
  },
]

class StaticKeys implements KeyResolver {
  constructor(private readonly values: Map<string, Uint8Array>) {}
  async resolve(reference: string) {
    const value = this.values.get(reference)
    if (value === undefined) throw new Error(`unknown key reference ${reference}`)
    return value
  }
}

class IsolatedTarget implements RestoreTargetPort {
  readonly isolation = 'isolated' as const
  readonly records = new Map<string, BackupRecord>()
  constructor(
    readonly targetId: string,
    private readonly verifyOverride?: {
      authenticated: boolean
      readable: boolean
      searchable: boolean
    },
  ) {}
  async preflight() {
    return { existingRecords: this.records.size }
  }
  async hasRecord(recordId: string) {
    return this.records.has(recordId)
  }
  async writeRecord(record: BackupRecord, policy: 'fail' | 'skip' | 'replace') {
    if (this.records.has(record.id)) {
      if (policy === 'fail') throw new Error('collision')
      if (policy === 'skip') return 'skipped' as const
      this.records.set(record.id, record)
      return 'replaced' as const
    }
    this.records.set(record.id, record)
    return 'created' as const
  }
  async verify() {
    return this.verifyOverride ?? { authenticated: true, readable: true, searchable: true }
  }
}

describe('encrypted content-addressed backup and isolated restore', () => {
  let temp: string | undefined
  afterEach(async () => {
    if (temp !== undefined) {
      try {
        rmSync(temp, { recursive: true, force: true })
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
        try {
          rmSync(temp, { recursive: true, force: true })
        } catch {
          // ignore Windows lock delay
        }
      }
    }
  })

  it('resumes a partial generation after SQLite/process restart and preserves encrypted content', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-'))
    const root = join(temp, 'objects')
    const dbPath = join(temp, 'journal.db')
    const store = new FilesystemObjectStore(root)
    const key = new Uint8Array(32).fill(7)
    const keys = new StaticKeys(new Map([['fixture-key-ref', key]]))
    const journal = new RecoveryJournal(dbPath)
    const core = new RecoveryCore({ store, keys, journal })
    const generationId = 'generation-one'
    async function* crashAfterFirst() {
      yield records[0]!
      throw new Error('simulated process crash')
    }
    await expect(
      core.createGeneration(crashAfterFirst(), 'fixture-key-ref', generationId),
    ).rejects.toThrow('simulated process crash')
    journal.close()

    const restartedJournal = new RecoveryJournal(dbPath)
    const resumed = new RecoveryCore({ store, keys, journal: restartedJournal })
    const result = await resumed.createGeneration(records, 'fixture-key-ref', generationId)
    expect(result.complete).toBe(true)
    expect(result.manifest.entries).toHaveLength(records.length)
    expect(result.reused).toBeGreaterThanOrEqual(1)
    const manifestBytes = await store.get(manifestKey(generationId))
    expect(new TextDecoder().decode(manifestBytes)).not.toContain(Buffer.from(key).toString('hex'))
    expect(
      (await store.list('generations/generation-one/')).filter((name) =>
        name.endsWith('/complete'),
      ),
    ).toHaveLength(1)
    const storedObjects = await store.list('objects/sha256/')
    expect(storedObjects).toHaveLength(records.length + 1)
    restartedJournal.close()
  })

  it('requires the right key and reports tampering during restore verification', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(11)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key-a', key]])) })
    const generation = await core.createGeneration(records, 'key-a', 'tamper-generation')
    const target = new IsolatedTarget('isolated-fixture-target')
    const dryRun = await core.restore(generation.generationId, {
      mode: 'dry-run',
      target,
      collisionPolicy: 'fail',
    })
    expect(dryRun.backupSuccess).toBe(false)
    await expect(
      new RecoveryCore({
        store,
        keys: new StaticKeys(new Map([['key-a', new Uint8Array(32).fill(12)]])),
      }).readManifest(generation.generationId),
    ).rejects.toThrow()

    const restored = await core.restore(generation.generationId, {
      mode: 'restore',
      target,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'tier3-fixture-approval' },
    })
    expect(restored.backupSuccess).toBe(true)
    expect(restored.verifiedHashes).toBe(records.length)
    expect(target.records.get('message:one')?.metadata.labels).toEqual(['inbox'])

    const entry = generation.manifest.entries.find((candidate) => candidate.id === 'message:one')!
    const filePath = join(temp, entry.objectKey.replaceAll('/', '\\'))
    const tampered = new Uint8Array(
      await import('node:fs/promises').then(({ readFile }) => readFile(filePath)),
    )
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    await import('node:fs/promises').then(({ writeFile }) => writeFile(filePath, tampered))
    const failed = await core.restore(generation.generationId, {
      mode: 'restore',
      target: new IsolatedTarget('isolated-fixture-target-2'),
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'tier3-fixture-approval-2' },
    })
    expect(failed.backupSuccess).toBe(false)
    expect(failed.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: 'message:one' })]),
    )
  })

  it('applies immutable-generation retention and collision policy', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(4)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key', key]])) })
    await core.createGeneration(records.slice(0, 1), 'key', 'old-generation')
    await new Promise((resolve) => setTimeout(resolve, 2))
    const newer = await core.createGeneration(records.slice(0, 2), 'key', 'new-generation')
    const removed = await core.applyRetention({ keepGenerations: 1 })
    expect(removed).toEqual(['old-generation'])
    const target = new IsolatedTarget('collision-target')
    const first = await core.restore(newer.generationId, {
      mode: 'restore',
      target,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-a' },
    })
    expect(first.restored).toBe(2)
    const skipped = await core.restore(newer.generationId, {
      mode: 'restore',
      target,
      collisionPolicy: 'skip',
      approval: { tier: 3, approved: true, approvalId: 'approval-b' },
    })
    expect(skipped.skipped).toBe(2)
  })

  it('supports S3-compatible object store port with SigV4 authentication and immutable puts', async () => {
    const memoryBackend = new Map<string, Uint8Array>()
    const authHeaders: string[] = []

    const mockFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : (input as Request).url)
      const method = init?.method ?? 'GET'
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers['authorization']) {
        authHeaders.push(headers['authorization'])
      }

      // Path style: /bucket/key
      const key = url.pathname.replace(/^\/my-test-bucket\/?/, '')

      if (method === 'HEAD') {
        if (memoryBackend.has(key)) {
          return new Response(null, { status: 200 })
        }
        return new Response(null, { status: 404 })
      }

      if (method === 'PUT') {
        if (memoryBackend.has(key)) {
          return new Response('Precondition Failed', { status: 412 })
        }
        const body = init?.body as Uint8Array
        memoryBackend.set(key, body)
        return new Response(null, { status: 200 })
      }

      if (method === 'GET') {
        if (url.searchParams.get('list-type') === '2') {
          const prefix = url.searchParams.get('prefix') ?? ''
          const matching = Array.from(memoryBackend.keys())
            .filter((k) => k.startsWith(prefix))
            .sort()
          const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  ${matching.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('\n  ')}
</ListBucketResult>`
          return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } })
        }

        const data = memoryBackend.get(key)
        if (data === undefined) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(data as unknown as BodyInit, { status: 200 })
      }

      if (method === 'DELETE') {
        memoryBackend.delete(key)
        return new Response(null, { status: 204 })
      }

      return new Response('Method Not Allowed', { status: 405 })
    }

    const s3 = new S3CompatibleObjectStore({
      endpoint: 'https://s3.example.com',
      bucket: 'my-test-bucket',
      accessKeyId: 'AKIA_FIXTURE_KEY',
      secretAccessKey: 'SECRET_FIXTURE_KEY_12345',
      fetchFn: mockFetch,
    })

    expect(s3.provider).toBe('s3-compatible')
    const put1 = await s3.putImmutable('objects/test.txt', bytes('first write'))
    expect(put1).toBe('created')

    const put2 = await s3.putImmutable('objects/test.txt', bytes('second write'))
    expect(put2).toBe('exists')

    const read = await s3.get('objects/test.txt')
    expect(new TextDecoder().decode(read)).toBe('first write')

    const list = await s3.list('objects/')
    expect(list).toEqual(['objects/test.txt'])

    expect(authHeaders.length).toBeGreaterThan(0)
    expect(authHeaders[0]).toContain('AWS4-HMAC-SHA256 Credential=AKIA_FIXTURE_KEY')

    await s3.delete('objects/test.txt')
    const listAfterDelete = await s3.list('objects/')
    expect(listAfterDelete).toEqual([])
  })

  it('performs thorough dry-run with collision detection and enforces isolation and Tier-3 approval', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-dry-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(5)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key-5', key]])) })
    const generation = await core.createGeneration(records, 'key-5', 'gen-dry')

    // Refusal: Non-isolated target
    const nonIsolated = {
      targetId: 'shared-target',
      isolation: 'shared' as unknown as 'isolated',
      async preflight() {
        return { existingRecords: 0 }
      },
      async writeRecord() {
        return 'created' as const
      },
      async verify() {
        return { authenticated: true, readable: true, searchable: true }
      },
    }
    await expect(
      core.restore(generation.generationId, {
        mode: 'restore',
        target: nonIsolated,
        collisionPolicy: 'fail',
        approval: { tier: 3, approved: true, approvalId: 'approval-tier3' },
      }),
    ).rejects.toThrow('Restore refused: target must be explicitly isolated')

    // Refusal: Missing Tier-3 approval in restore mode
    const isolated = new IsolatedTarget('isolated-target-1')
    await expect(
      core.restore(generation.generationId, {
        mode: 'restore',
        target: isolated,
        collisionPolicy: 'fail',
      }),
    ).rejects.toThrow('Restore refused: Tier-3 approval is required for restore mutation')

    // Preflight mode
    const preflightRes = await core.restore(generation.generationId, {
      mode: 'preflight',
      target: isolated,
      collisionPolicy: 'fail',
    })
    expect(preflightRes.mode).toBe('preflight')
    expect(preflightRes.preflight.entries).toBe(records.length)
    expect(isolated.records.size).toBe(0)

    // Dry-run mode with pre-existing record on target
    isolated.records.set('account:alice', records[0]!)
    const dryRunSkip = await core.restore(generation.generationId, {
      mode: 'dry-run',
      target: isolated,
      collisionPolicy: 'skip',
    })
    expect(dryRunSkip.mode).toBe('dry-run')
    expect(dryRunSkip.verifiedHashes).toBe(records.length)
    expect(dryRunSkip.skipped).toBe(1)
    expect(dryRunSkip.restored).toBe(records.length - 1)
    expect(dryRunSkip.backupSuccess).toBe(false)
    // Dry-run must NOT mutate target!
    expect(isolated.records.size).toBe(1)
  })

  it('handles partial generation cleanup and prunes orphaned content-addressed objects', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-cleanup-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(9)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key-9', key]])) })

    // Simulate an incomplete generation
    const incompleteId = 'partial-generation-crash'
    await store.putImmutable(manifestKey(incompleteId), bytes('partial-manifest'))
    await store.putImmutable(indexKey(incompleteId), bytes('partial-index'))
    await store.putImmutable(objectKeyFor('orphan-content-hash-123'), bytes('orphan payload'))

    const cleaned = await core.cleanupPartial()
    expect(cleaned).toContain(incompleteId)

    const remaining = await store.list()
    expect(remaining.some((k) => k.includes(incompleteId))).toBe(false)
    expect(remaining.some((k) => k.includes('orphan-content-hash-123'))).toBe(false)
  })

  it('refuses restore when verification checks fail (authenticated, readable, searchable)', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-verify-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(8)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key-8', key]])) })
    const generation = await core.createGeneration(records.slice(0, 1), 'key-8', 'gen-verify')

    const unverifiedTarget = new IsolatedTarget('unverified-target', {
      authenticated: true,
      readable: false, // verification fails
      searchable: true,
    })

    const result = await core.restore(generation.generationId, {
      mode: 'restore',
      target: unverifiedTarget,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-v' },
    })

    expect(result.backupSuccess).toBe(false)
    expect(result.verification?.readable).toBe(false)
  })

  it('validates content-addressed encrypted manifests and detects manifest tampering', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-manifest-'))
    const store = new FilesystemObjectStore(temp)
    const key = new Uint8Array(32).fill(3)
    const core = new RecoveryCore({ store, keys: new StaticKeys(new Map([['key-3', key]])) })
    const generation = await core.createGeneration(records.slice(0, 2), 'key-3', 'gen-manifest')

    expect(generation.manifest.manifestHash).toBeDefined()
    const read = await core.readManifest(generation.generationId)
    expect(read.manifestHash).toBe(generation.manifest.manifestHash)

    // Tamper with index file on disk
    const indexPath = join(temp, indexKey(generation.generationId).replaceAll('/', '\\'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(indexPath, bytes('invalid-tampered-index'))
    await expect(
      core.restore(generation.generationId, {
        mode: 'restore',
        target: new IsolatedTarget('t'),
        collisionPolicy: 'fail',
        approval: { tier: 3, approved: true, approvalId: 'app' },
      }),
    ).rejects.toThrow()
  })

  it('rejects directory escape attempts in FilesystemObjectStore', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-sec-'))
    const store = new FilesystemObjectStore(temp)
    await expect(store.putImmutable('../escape.txt', bytes('evil'))).rejects.toThrow('escapes')
    await expect(store.get('/absolute/path')).rejects.toThrow('relative')
  })

  it('supports two generations with rotated/different keys for identical content with independent successful restores', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-rot-'))
    const store = new FilesystemObjectStore(temp)
    const key1 = new Uint8Array(32).fill(1)
    const key2 = new Uint8Array(32).fill(2)
    const keys = new StaticKeys(
      new Map([
        ['key-v1', key1],
        ['key-v2', key2],
      ]),
    )
    const core = new RecoveryCore({ store, keys })

    // Gen 1 with key-v1
    const gen1 = await core.createGeneration(records, 'key-v1', 'gen-1')
    expect(gen1.complete).toBe(true)

    // Gen 2 with key-v2 and identical content
    const gen2 = await core.createGeneration(records, 'key-v2', 'gen-2')
    expect(gen2.complete).toBe(true)

    // Restore Gen 1 using key-v1
    const target1 = new IsolatedTarget('target-1')
    const restore1 = await core.restore(gen1.generationId, {
      mode: 'restore',
      target: target1,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-1' },
    })
    expect(restore1.backupSuccess).toBe(true)
    expect(restore1.restored).toBe(records.length)

    // Restore Gen 2 using key-v2
    const target2 = new IsolatedTarget('target-2')
    const restore2 = await core.restore(gen2.generationId, {
      mode: 'restore',
      target: target2,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-2' },
    })
    expect(restore2.backupSuccess).toBe(true)
    expect(restore2.restored).toBe(records.length)
  })

  it('supports two generations with the same keyReference but rotated key bytes for identical content', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-same-ref-rot-'))
    const store = new FilesystemObjectStore(temp)
    const key1 = new Uint8Array(32).fill(42)
    const key2 = new Uint8Array(32).fill(99)
    class RotatableKeys implements KeyResolver {
      public activeKey: Uint8Array = key1
      async resolve() {
        return this.activeKey
      }
    }
    const keys = new RotatableKeys()
    const core = new RecoveryCore({ store, keys })

    // Gen 1 created with key1 under alias 'primary-key'
    keys.activeKey = key1
    const gen1 = await core.createGeneration(records, 'primary-key', 'gen-rot-1')
    expect(gen1.complete).toBe(true)

    // Gen 2 created with key2 under the same alias 'primary-key' and identical records
    keys.activeKey = key2
    const gen2 = await core.createGeneration(records, 'primary-key', 'gen-rot-2')
    expect(gen2.complete).toBe(true)

    // Verify object keys in manifest are different because envelope hashes differ
    const gen1Keys = gen1.manifest.entries.map((e) => e.objectKey)
    const gen2Keys = gen2.manifest.entries.map((e) => e.objectKey)
    expect(gen1Keys).not.toEqual(gen2Keys)

    // Restore Gen 1 with key1
    keys.activeKey = key1
    const target1 = new IsolatedTarget('target-rot-1')
    const restore1 = await core.restore(gen1.generationId, {
      mode: 'restore',
      target: target1,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-rot-1' },
    })
    expect(restore1.backupSuccess).toBe(true)
    expect(restore1.restored).toBe(records.length)

    // Restore Gen 2 with key2
    keys.activeKey = key2
    const target2 = new IsolatedTarget('target-rot-2')
    const restore2 = await core.restore(gen2.generationId, {
      mode: 'restore',
      target: target2,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'approval-rot-2' },
    })
    expect(restore2.backupSuccess).toBe(true)
    expect(restore2.restored).toBe(records.length)
  })

  it('avoids storage path collisions for colliding keyReference names like a/b vs a_b', async () => {
    temp = mkdtempSync(join(tmpdir(), 'navin-recovery-collide-ref-'))
    const store = new FilesystemObjectStore(temp)
    const keyA = new Uint8Array(32).fill(111)
    const keyB = new Uint8Array(32).fill(222)
    const keys = new StaticKeys(
      new Map([
        ['keys/prod', keyA],
        ['keys_prod', keyB],
      ]),
    )
    const core = new RecoveryCore({ store, keys })

    const genA = await core.createGeneration(records, 'keys/prod', 'gen-collide-a')
    const genB = await core.createGeneration(records, 'keys_prod', 'gen-collide-b')
    expect(genA.complete).toBe(true)
    expect(genB.complete).toBe(true)

    const targetA = new IsolatedTarget('target-a')
    const resA = await core.restore(genA.generationId, {
      mode: 'restore',
      target: targetA,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'app-a' },
    })
    expect(resA.backupSuccess).toBe(true)
    expect(resA.restored).toBe(records.length)

    const targetB = new IsolatedTarget('target-b')
    const resB = await core.restore(genB.generationId, {
      mode: 'restore',
      target: targetB,
      collisionPolicy: 'fail',
      approval: { tier: 3, approved: true, approvalId: 'app-b' },
    })
    expect(resB.backupSuccess).toBe(true)
    expect(resB.restored).toBe(records.length)
  })

  it('rejects non-HTTPS S3 endpoints and validates canonical transport policy', () => {
    const validConfig = {
      bucket: 'test-bucket',
      accessKeyId: 'test-ak',
      secretAccessKey: 'test-sk',
    }

    // Reject non-HTTPS non-loopback
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://s3.example.com' }),
    ).toThrow('only literal loopback IPs are allowed')
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://192.0.2.1:9000' }),
    ).toThrow('only literal loopback IPs are allowed')

    // Reject ambiguous localhost hostname
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://localhost:9000' }),
    ).toThrow('ambiguous localhost hostname')
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://app.localhost:9000' }),
    ).toThrow('ambiguous localhost hostname')

    // Reject credentials in URL
    expect(
      () =>
        new S3CompatibleObjectStore({
          ...validConfig,
          endpoint: 'http://user:pass@127.0.0.1:9000',
        }),
    ).toThrow('credentials')

    // Reject query parameters and hash
    expect(
      () =>
        new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://127.0.0.1:9000?query=1' }),
    ).toThrow('query parameters, or a hash')
    expect(
      () =>
        new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://127.0.0.1:9000#fragment' }),
    ).toThrow('query parameters, or a hash')

    // Reject traversal and encoded separators
    expect(
      () =>
        new S3CompatibleObjectStore({
          ...validConfig,
          endpoint: 'http://127.0.0.1:9000/../traversal',
        }),
    ).toThrow('Traversal is not allowed')
    expect(
      () =>
        new S3CompatibleObjectStore({
          ...validConfig,
          endpoint: 'http://127.0.0.1:9000/%2f',
        }),
    ).toThrow('Unsafe')
    expect(
      () =>
        new S3CompatibleObjectStore({
          ...validConfig,
          endpoint: 'http://127.0.0.1:9000/a\\b',
        }),
    ).toThrow('Unsafe')

    // Reject ambiguous numeric hosts
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://0177.0.0.1:9000' }),
    ).toThrow('ambiguous numeric')
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://2130706433:9000' }),
    ).toThrow('ambiguous numeric')
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://0x7f000001:9000' }),
    ).toThrow('ambiguous numeric')

    // Accept literal loopback HTTP
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://127.0.0.1:9000' }),
    ).not.toThrow()
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'http://[::1]:9000' }),
    ).not.toThrow()

    // Accept HTTPS
    expect(
      () => new S3CompatibleObjectStore({ ...validConfig, endpoint: 'https://s3.example.com' }),
    ).not.toThrow()
  })
})

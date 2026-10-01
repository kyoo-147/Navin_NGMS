import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuard } from '../src/guard.mjs'
import { loadManifest, ManifestError, orderEntries, validateManifest } from '../src/manifest.mjs'
import { createStubRegistry } from '../src/test-support.mjs'

const guard = createGuard()
const valid = {
  manifestVersion: 1,
  name: 'unit-manifest',
  entries: [
    { id: 'a', name: 'A', evidenceClass: 'unit', executor: 'self.classes' },
    {
      id: 'b',
      name: 'B',
      evidenceClass: 'protocol',
      executor: 'protocol.smtp-banner',
      dependsOn: ['a'],
    },
  ],
}

test('a valid manifest passes validation', () => {
  const result = validateManifest(valid, { guard })
  assert.equal(result.valid, true, JSON.stringify(result.errors))
})

test('manifests referencing production endpoints are rejected', () => {
  const dangerous = {
    manifestVersion: 1,
    name: 'dangerous',
    entries: [
      {
        id: 'a',
        name: 'A',
        evidenceClass: 'protocol',
        executor: 'protocol.smtp-banner',
        target: 'mail.production.example.invalid',
      },
    ],
  }
  const result = validateManifest(dangerous, { guard })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /production endpoint/.test(error.message)))
  assert.throws(() => {
    if (!result.valid) {
      throw new ManifestError(result.errors)
    }
  }, ManifestError)
})

test('structural errors are reported', () => {
  const cases = [
    { manifest: { manifestVersion: 2, name: 'x', entries: [{}] }, path: 'manifestVersion' },
    { manifest: { manifestVersion: 1, name: 'x', entries: [] }, path: 'entries' },
    {
      manifest: {
        manifestVersion: 1,
        name: 'x',
        entries: [
          { id: 'dup', name: 'A', evidenceClass: 'unit', executor: 'x' },
          { id: 'dup', name: 'B', evidenceClass: 'unit', executor: 'x' },
        ],
      },
      path: 'entries[1].id',
    },
    {
      manifest: {
        manifestVersion: 1,
        name: 'x',
        entries: [{ id: 'a', name: 'A', evidenceClass: 'screenshot', executor: 'x' }],
      },
      path: 'entries[0].evidenceClass',
    },
    {
      manifest: {
        manifestVersion: 1,
        name: 'x',
        entries: [{ id: 'a', name: 'A', evidenceClass: 'unit' }],
      },
      path: 'entries[0].executor',
    },
    {
      manifest: {
        manifestVersion: 1,
        name: 'x',
        entries: [
          { id: 'a', name: 'A', evidenceClass: 'unit', executor: 'x', dependsOn: ['ghost'] },
        ],
      },
      path: 'entries[a].dependsOn',
    },
  ]
  for (const { manifest, path } of cases) {
    const result = validateManifest(manifest, { guard })
    assert.equal(result.valid, false, `expected invalid for ${path}`)
    assert.ok(
      result.errors.some((error) => error.path === path),
      `expected error at ${path}: ${JSON.stringify(result.errors)}`,
    )
  }
})

test('dependency cycles are rejected', () => {
  const cyclic = {
    manifestVersion: 1,
    name: 'cycle',
    entries: [
      { id: 'a', name: 'A', evidenceClass: 'unit', executor: 'x', dependsOn: ['b'] },
      { id: 'b', name: 'B', evidenceClass: 'unit', executor: 'y', dependsOn: ['a'] },
    ],
  }
  const result = validateManifest(cyclic, { guard })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /cycle/.test(error.message)))
})

test('orderEntries places dependencies before dependants', () => {
  const ordered = orderEntries([
    { id: 'c', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'a' },
  ])
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ['a', 'b', 'c'],
  )
})

test('loadManifest surfaces invalid JSON as ManifestError', () => {
  assert.throws(() => loadManifest('does/not/exist.manifest.json'), ManifestError)
})

test('allowUnknown escape hatch is rejected', () => {
  const manifest = {
    manifestVersion: 1,
    name: 'x',
    allowUnknown: true,
    entries: [{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'self.classes' }],
  }
  const result = validateManifest(manifest, { guard })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.path === 'allowUnknown'))
})

test('target-using executors require a real network target', () => {
  const registry = createStubRegistry({
    'net.tcp-reachability': { target: { required: true, param: 'host' } },
  })
  const missing = {
    manifestVersion: 1,
    name: 'x',
    entries: [
      {
        id: 'tcp',
        name: 'TCP',
        evidenceClass: 'integration',
        executor: 'net.tcp-reachability',
        params: { port: 1025 },
      },
    ],
  }
  const result = validateManifest(missing, { guard, registry })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /requires a network target/.test(error.message)))

  const provided = {
    ...missing,
    entries: [{ ...missing.entries[0], target: '127.0.0.1' }],
  }
  assert.equal(validateManifest(provided, { guard, registry }).valid, true)
})

test('entry.target must agree with the executor target param', () => {
  const registry = createStubRegistry({ tcp: { target: { required: true, param: 'host' } } })
  const mismatch = {
    manifestVersion: 1,
    name: 'x',
    entries: [
      {
        id: 'tcp',
        name: 'TCP',
        evidenceClass: 'integration',
        executor: 'tcp',
        target: 'localhost',
        params: { host: 'thing.test' },
      },
    ],
  }
  const result = validateManifest(mismatch, { guard, registry })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /disagrees/.test(error.message)))

  const matched = {
    ...mismatch,
    entries: [{ ...mismatch.entries[0], params: { host: 'localhost' } }],
  }
  assert.equal(validateManifest(matched, { guard, registry }).valid, true)
})

test('external evidence requires an explicitly allow-listed target', () => {
  const registry = createStubRegistry({ dns: { target: { required: true, param: 'domain' } } })
  const manifest = {
    manifestVersion: 1,
    name: 'x',
    entries: [
      {
        id: 'dns',
        name: 'DNS',
        evidenceClass: 'external',
        executor: 'dns',
        params: { domain: 'example.test' },
      },
    ],
  }
  const notListed = validateManifest(manifest, { guard, registry })
  assert.equal(notListed.valid, false)
  assert.ok(notListed.errors.some((error) => /explicitly allow-listed/.test(error.message)))

  const listed = validateManifest(
    { ...manifest, allow: ['example.test'] },
    { guard: createGuard({ allow: ['example.test'] }), registry },
  )
  assert.equal(listed.valid, true)
})

test('effective target from params is guarded even without entry.target', () => {
  const registry = createStubRegistry({ dns: { target: { required: true, param: 'domain' } } })
  const manifest = {
    manifestVersion: 1,
    name: 'x',
    allow: [],
    entries: [
      {
        id: 'dns',
        name: 'DNS',
        evidenceClass: 'external',
        executor: 'dns',
        params: { domain: 'external-vm.example.net' },
      },
    ],
  }
  const result = validateManifest(manifest, { guard, registry })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /allow-listed|deny by default/.test(error.message)))
})

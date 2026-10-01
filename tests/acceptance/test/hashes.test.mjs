import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildIndex,
  IndexError,
  isSafeRelativePath,
  normalizeEntryPath,
  resolveInsideRoot,
  sha256Hex,
  sha256Json,
  stableStringify,
  verifyIndex,
} from '../src/hashes.mjs'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'navin-hashes-'))
}

test("sha256Hex matches the known digest of 'abc'", () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('stableStringify is key-order independent', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }))
})

test('normalizeEntryPath rejects absolute and traversing paths', () => {
  for (const bad of [
    '/etc/passwd',
    '\\windows\\system32',
    'C:\\secrets.txt',
    'c:/secrets.txt',
    '../escape.txt',
    'a/../../escape.txt',
    'a/..',
    '..',
    'x\0y',
    '',
  ]) {
    assert.equal(normalizeEntryPath(bad), null, `expected unsafe: ${JSON.stringify(bad)}`)
    assert.equal(isSafeRelativePath(bad), false, `expected unsafe: ${JSON.stringify(bad)}`)
  }
})

test('normalizeEntryPath collapses mixed separators and dot segments', () => {
  assert.equal(normalizeEntryPath('a\\b/c.txt'), 'a/b/c.txt')
  assert.equal(normalizeEntryPath('./a/./b'), 'a/b')
  assert.equal(normalizeEntryPath('a//b'), 'a/b')
})

test('resolveInsideRoot keeps resolution within the root', () => {
  const root = path.resolve('/tmp/navin-root')
  assert.ok(resolveInsideRoot(root, 'a/b.txt'))
  assert.equal(resolveInsideRoot(root, '../b.txt'), null)
  assert.equal(resolveInsideRoot(root, '/abs.txt'), null)
})

test('index verifies clean files and detects tampering', () => {
  const dir = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'beta')
    const index = buildIndex(dir, ['b.txt', 'a.txt'])
    assert.equal(index.entries.length, 2)
    assert.deepEqual(
      index.entries.map((entry) => entry.path),
      ['a.txt', 'b.txt'],
    )
    assert.ok(verifyIndex(dir, index).ok)

    fs.appendFileSync(path.join(dir, 'a.txt'), '-tampered')
    const after = verifyIndex(dir, index)
    assert.equal(after.ok, false)
    assert.ok(after.errors.some((error) => error.type === 'hash-mismatch'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('index integrity detects a rewritten entry list', () => {
  const dir = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    const index = buildIndex(dir, ['a.txt'])
    const tampered = { ...index, entries: [{ ...index.entries[0], sha256: '0'.repeat(64) }] }
    const result = verifyIndex(dir, tampered)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => error.type === 'index-integrity'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildIndex rejects unsafe, duplicate and malformed inputs', () => {
  const dir = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    assert.throws(() => buildIndex(dir, ['../escape.txt']), IndexError)
    assert.throws(() => buildIndex(dir, ['/abs.txt']), IndexError)
    assert.throws(() => buildIndex(dir, ['a.txt', 'a.txt']), IndexError)
    assert.throws(() => buildIndex(dir, ['a.txt', 'a.txt']), /duplicate/i)
    assert.throws(() => buildIndex(dir, 'not-an-array'), IndexError)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('verifyIndex rejects traversal, duplicates and malformed entries without reading outside', () => {
  const dir = tmpDir()
  const outside = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
    const base = buildIndex(dir, ['a.txt'])

    const traversal = {
      ...base,
      entries: [...base.entries, { path: '../secret.txt', bytes: 10, sha256: '0'.repeat(64) }],
    }
    const traversalResult = verifyIndex(dir, traversal)
    assert.ok(traversalResult.errors.some((error) => error.type === 'unsafe-path'))

    const absolute = {
      ...base,
      entries: [{ path: path.join(outside, 'secret.txt'), bytes: 10, sha256: '0'.repeat(64) }],
    }
    assert.ok(verifyIndex(dir, absolute).errors.some((error) => error.type === 'unsafe-path'))

    const duplicate = { ...base, entries: [base.entries[0], base.entries[0]] }
    assert.ok(verifyIndex(dir, duplicate).errors.some((error) => error.type === 'duplicate-entry'))

    const malformed = { ...base, entries: [{ path: 'a.txt', bytes: 'x', sha256: 'nope' }] }
    assert.ok(verifyIndex(dir, malformed).errors.some((error) => error.type === 'malformed-entry'))

    const notArray = { ...base, entries: 'nope' }
    assert.equal(verifyIndex(dir, notArray).ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('index rejects symlinks that escape the root', (t) => {
  const dir = tmpDir()
  const outside = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'), 'file')
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.code}`)
      return
    }
    assert.throws(() => buildIndex(dir, ['link.txt']), /symlink|escape/i)

    const index = buildIndex(dir, ['a.txt'])
    const withLink = {
      ...index,
      entries: [...index.entries, { path: 'link.txt', bytes: 10, sha256: '0'.repeat(64) }],
    }
    const result = verifyIndex(dir, withLink)
    assert.ok(result.errors.some((error) => error.type === 'symlink-escape'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('verifyIndex rejects non-canonical and unsorted entry paths', () => {
  const dir = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'beta')
    const base = buildIndex(dir, ['a.txt', 'b.txt'])

    const nonCanonicalEntries = [{ ...base.entries[0], path: './a.txt' }, base.entries[1]]
    const nonCanonical = {
      ...base,
      entries: nonCanonicalEntries,
      indexSha256: sha256Json(nonCanonicalEntries),
    }
    assert.ok(
      verifyIndex(dir, nonCanonical).errors.some((error) => error.type === 'non-canonical-path'),
    )

    const unsortedEntries = [base.entries[1], base.entries[0]]
    const unsorted = { ...base, entries: unsortedEntries, indexSha256: sha256Json(unsortedEntries) }
    assert.ok(verifyIndex(dir, unsorted).errors.some((error) => error.type === 'unsorted-entries'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('verifyIndex rejects bad index metadata (version and entryCount)', () => {
  const dir = tmpDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
    const base = buildIndex(dir, ['a.txt'])
    assert.ok(
      verifyIndex(dir, { ...base, indexVersion: 2 }).errors.some(
        (error) => error.type === 'unsupported-index-version',
      ),
    )
    assert.ok(
      verifyIndex(dir, { ...base, entryCount: 2 }).errors.some(
        (error) => error.type === 'entry-count-mismatch',
      ),
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

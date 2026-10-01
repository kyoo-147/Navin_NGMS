import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { verifyBundle, writeBundle } from '../src/bundle.mjs'
import { createGuard } from '../src/guard.mjs'
import { sha256Hex } from '../src/hashes.mjs'
import { createRedactor } from '../src/redaction.mjs'
import { runManifest } from '../src/runner.mjs'
import { STATUS } from '../src/status.mjs'
import { createStubRegistry, makeManifest, makeReceipt } from '../src/test-support.mjs'

const guard = createGuard()
const redactor = createRedactor()

async function buildRun() {
  const executors = {
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }])
  return runManifest(manifest, { registry: createStubRegistry(executors), guard, redactor })
}

test('writeBundle emits manifest, run, receipts, a SHA-256 index and index.sha256', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const manifest = makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }])
    const { bundleDir, index, indexSha256 } = writeBundle(run, manifest, { outDir })

    assert.ok(fs.existsSync(path.join(bundleDir, 'manifest.json')))
    assert.ok(fs.existsSync(path.join(bundleDir, 'run.json')))
    assert.ok(fs.existsSync(path.join(bundleDir, 'index.json')))
    assert.ok(fs.existsSync(path.join(bundleDir, 'index.sha256')))
    assert.equal(index.entryCount, 3)
    assert.equal(index.algorithm, 'sha256')

    const indexBytes = fs.readFileSync(path.join(bundleDir, 'index.json'))
    assert.equal(indexSha256, sha256Hex(indexBytes))
    assert.equal(
      fs.readFileSync(path.join(bundleDir, 'index.sha256'), 'utf8').trim().split(/\s+/)[0],
      indexSha256,
    )

    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, true, JSON.stringify(verified.errors))
    assert.equal(verified.checked, 3)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyBundle detects tampering with an artifact', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const { bundleDir } = writeBundle(
      run,
      makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }]),
      { outDir },
    )
    fs.appendFileSync(path.join(bundleDir, 'run.json'), '\n')
    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, false)
    assert.ok(verified.errors.some((error) => error.type === 'hash-mismatch'))
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyBundle detects a rewritten index', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const { bundleDir } = writeBundle(
      run,
      makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }]),
      { outDir },
    )
    const indexPath = path.join(bundleDir, 'index.json')
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    parsed.entries = parsed.entries.map((entry) => ({ ...entry, sha256: '0'.repeat(64) }))
    fs.writeFileSync(indexPath, `${JSON.stringify(parsed, null, 2)}\n`)
    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, false)
    assert.ok(verified.errors.some((error) => error.type === 'index-sha-mismatch'))
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyBundle rejects an unindexed added file', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const { bundleDir } = writeBundle(
      run,
      makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }]),
      { outDir },
    )
    fs.writeFileSync(path.join(bundleDir, 'extra.txt'), 'smuggled')
    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, false)
    assert.ok(
      verified.errors.some(
        (error) => error.type === 'unindexed-file' && error.path === 'extra.txt',
      ),
    )
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyBundle rejects a missing indexed file', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const { bundleDir } = writeBundle(
      run,
      makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }]),
      { outDir },
    )
    fs.rmSync(path.join(bundleDir, 'run.json'))
    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, false)
    assert.ok(
      verified.errors.some(
        (error) => error.type === 'missing-file' || error.type === 'missing-from-bundle',
      ),
    )
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyBundle rejects bad index metadata (version and entryCount)', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-bundle-'))
  try {
    const run = await buildRun()
    const { bundleDir } = writeBundle(
      run,
      makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }]),
      { outDir },
    )
    const indexPath = path.join(bundleDir, 'index.json')
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    parsed.indexVersion = 2
    parsed.entryCount = parsed.entries.length + 1
    fs.writeFileSync(indexPath, `${JSON.stringify(parsed, null, 2)}\n`)
    fs.writeFileSync(
      path.join(bundleDir, 'index.sha256'),
      `${sha256Hex(fs.readFileSync(indexPath))}  index.json\n`,
    )
    const verified = verifyBundle(bundleDir)
    assert.equal(verified.ok, false)
    assert.ok(verified.errors.some((error) => error.type === 'unsupported-index-version'))
    assert.ok(verified.errors.some((error) => error.type === 'entry-count-mismatch'))
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

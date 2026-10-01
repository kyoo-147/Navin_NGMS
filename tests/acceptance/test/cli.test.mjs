import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const acceptanceRoot = path.resolve(here, '..')
const selftestManifest = path.join(acceptanceRoot, 'manifests', 'harness-selftest.manifest.json')
const phase1Manifest = path.join(acceptanceRoot, 'manifests', 'phase1.manifest.json')

async function silent(fn) {
  const outWrite = process.stdout.write
  const errWrite = process.stderr.write
  process.stdout.write = () => true
  process.stderr.write = () => true
  try {
    return await fn()
  } finally {
    process.stdout.write = outWrite
    process.stderr.write = errWrite
  }
}

test('validate accepts the committed manifests', async () => {
  assert.equal(await silent(() => main(['validate', '--manifest', selftestManifest])), 0)
  assert.equal(await silent(() => main(['validate', '--manifest', phase1Manifest])), 0)
})

test('list-executors and rules exit 0', async () => {
  assert.equal(await silent(() => main(['list-executors'])), 0)
  assert.equal(await silent(() => main(['rules'])), 0)
})

test('verify rejects a missing bundle', async () => {
  assert.equal(
    await silent(() => main(['verify', path.join(os.tmpdir(), 'definitely-missing-bundle')])),
    1,
  )
})

test('run of the harness selftest manifest is green and verifiable', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-cli-'))
  try {
    const code = await silent(() =>
      main(['run', '--manifest', selftestManifest, '--out', outDir, '--quiet']),
    )
    assert.equal(code, 0)
    const runs = fs.readdirSync(outDir)
    assert.equal(runs.length, 1)
    const bundleDir = path.join(outDir, runs[0])
    assert.equal(await silent(() => main(['verify', bundleDir])), 0)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

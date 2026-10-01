import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PreconditionError } from '../src/errors.mjs'
import { createDefaultRegistry } from '../src/executors.mjs'
import { createGuard } from '../src/guard.mjs'
import { createRedactor } from '../src/redaction.mjs'
import { STATUS } from '../src/status.mjs'

const registry = createDefaultRegistry()
const redactor = createRedactor()

function ctxFor(params, { guard = createGuard(), timeoutMs = 5000, target = null } = {}) {
  return {
    entry: { id: 't', name: 'T' },
    params,
    target,
    entryTarget: null,
    guard,
    redactor,
    correlationId: 't-11111111-1111-1111-1111-111111111111',
    timeoutMs,
    cwd: process.cwd(),
    signal: new AbortController().signal,
  }
}

test('registry exposes target metadata for target-using executors', () => {
  assert.deepEqual(registry.get('net.tcp-reachability').target, { required: true, param: 'host' })
  assert.deepEqual(registry.get('protocol.smtp-banner').target, { required: true, param: 'host' })
  assert.deepEqual(registry.get('browser.command').target, { required: true, param: 'url' })
  assert.deepEqual(registry.get('external.dns').target, { required: true, param: 'domain' })
  assert.deepEqual(registry.get('self.classes').target, { required: false, param: null })
  assert.deepEqual(registry.get('command.version').target, { required: false, param: null })
})

test('command.version refuses arbitrary command execution', async () => {
  await assert.rejects(
    registry.get('command.version').run(ctxFor({ argv: ['rm', '-rf', '/'] })),
    PreconditionError,
  )
  await assert.rejects(
    registry.get('command.version').run(ctxFor({ command: ['sh', '-c', 'echo hi'] })),
    PreconditionError,
  )
  await assert.rejects(
    registry.get('command.version').run(ctxFor({ probe: 'not-a-probe' })),
    PreconditionError,
  )
})

test('command.version runs an allow-listed version probe', async () => {
  const result = await registry.get('command.version').run(ctxFor({ probe: 'node' }))
  assert.equal(result.status, STATUS.PASS)
  assert.equal(result.receipts.length, 1)
})

test('browser.command guards the driver argv and rejects denied tokens', async () => {
  const guard = createGuard({ deny: ['blocked.example'] })
  await assert.rejects(
    registry
      .get('browser.command')
      .run(
        ctxFor({ url: 'http://localhost:5173', command: ['curl', 'blocked.example'] }, { guard }),
      ),
    PreconditionError,
  )
})

test('desktop.package requires an artifact and a launch command', async () => {
  await assert.rejects(registry.get('desktop.package').run(ctxFor({})), PreconditionError)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-desktop-'))
  try {
    const artifact = path.join(dir, 'app.exe')
    fs.writeFileSync(artifact, 'binary')
    await assert.rejects(
      registry.get('desktop.package').run(ctxFor({ artifactPath: artifact })),
      PreconditionError,
    )
    const guard = createGuard({ deny: ['blocked.example'] })
    await assert.rejects(
      registry
        .get('desktop.package')
        .run(ctxFor({ artifactPath: artifact, launchCommand: ['blocked.example'] }, { guard })),
      PreconditionError,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('external.deliverability requires an authorized probe', async () => {
  await assert.rejects(
    registry.get('external.deliverability').run(ctxFor({ domain: 'example.test' })),
    PreconditionError,
  )
})

test('browser.command requires the driver argv to reference params.url', async () => {
  await assert.rejects(
    registry
      .get('browser.command')
      .run(ctxFor({ url: 'http://localhost:5173', command: ['echo', 'hi'] })),
    PreconditionError,
  )
  const ok = await registry.get('browser.command').run(
    ctxFor({
      url: 'http://localhost:5173',
      command: [process.execPath, '-e', '0', 'http://localhost:5173'],
    }),
  )
  assert.equal(ok.status, STATUS.PASS)
})

test('desktop.package requires the launch command to reference the artifact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-desktop-'))
  try {
    const artifact = path.join(dir, 'app.exe')
    fs.writeFileSync(artifact, 'binary')
    await assert.rejects(
      registry
        .get('desktop.package')
        .run(ctxFor({ artifactPath: artifact, launchCommand: ['echo', 'hi'] })),
      PreconditionError,
    )
    const ok = await registry
      .get('desktop.package')
      .run(
        ctxFor({ artifactPath: artifact, launchCommand: [process.execPath, '-e', '0', artifact] }),
      )
    assert.equal(ok.status, STATUS.PASS)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('external.deliverability requires the probe to reference params.domain', async () => {
  await assert.rejects(
    registry
      .get('external.deliverability')
      .run(ctxFor({ domain: 'example.test', probe: ['echo', 'hi'] })),
    PreconditionError,
  )
  const ok = await registry
    .get('external.deliverability')
    .run(ctxFor({ domain: 'example.test', probe: [process.execPath, '-e', '0', 'example.test'] }))
  assert.equal(ok.status, STATUS.PASS)
})

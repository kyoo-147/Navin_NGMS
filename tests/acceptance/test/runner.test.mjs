import test from 'node:test'
import assert from 'node:assert/strict'
import { PreconditionError } from '../src/errors.mjs'
import { createGuard } from '../src/guard.mjs'
import { ManifestError } from '../src/manifest.mjs'
import { createRedactor } from '../src/redaction.mjs'
import { externalReceipt } from '../src/receipts.mjs'
import { runManifest } from '../src/runner.mjs'
import { STATUS } from '../src/status.mjs'
import { createStubRegistry, makeManifest, makeReceipt } from '../src/test-support.mjs'

const guard = createGuard()
const redactor = createRedactor()
const now = () => new Date().toISOString()

test('all-PASS run aggregates to PASS', async () => {
  const executors = {
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.status, STATUS.PASS)
  assert.equal(run.totals.PASS, 1)
})

test('missing executors report BLOCKED when required and NOT_RUN when optional', async () => {
  const manifest = makeManifest([
    { id: 'required', name: 'Required', evidenceClass: 'unit', executor: 'missing.executor' },
    {
      id: 'optional',
      name: 'Optional',
      evidenceClass: 'unit',
      executor: 'missing.executor',
      required: false,
    },
  ])
  const run = await runManifest(manifest, { registry: createStubRegistry({}), guard, redactor })
  assert.equal(run.entries[0].status, STATUS.BLOCKED)
  assert.equal(run.entries[1].status, STATUS.NOT_RUN)
  assert.equal(run.status, STATUS.BLOCKED)
  assert.equal(run.totals.PASS, 0)
})

test('unit evidence can never satisfy an external or desktop requirement at runtime', async () => {
  const executors = {
    'unit-only': {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const cases = [
    {
      evidenceClass: 'external',
      entry: { target: 'disposable.example.net' },
      guard: createGuard({ allow: ['disposable.example.net'] }),
    },
    { evidenceClass: 'desktop', entry: {}, guard },
  ]
  for (const { evidenceClass, entry, guard: caseGuard } of cases) {
    const manifest = makeManifest([
      { id: 'strong', name: 'Strong', evidenceClass, executor: 'unit-only', ...entry },
    ])
    const run = await runManifest(manifest, {
      registry: createStubRegistry(executors),
      guard: caseGuard,
      redactor,
    })
    assert.equal(run.entries[0].status, STATUS.FAIL)
    assert.match(run.entries[0].detail, /insufficient evidence class/)
  }
})

test('stronger evidence satisfies a stronger requirement', async () => {
  const executors = {
    external: {
      async run() {
        return {
          status: STATUS.PASS,
          receipts: [
            externalReceipt(
              { domain: 'example.test', status: STATUS.PASS, startedAt: now(), finishedAt: now() },
              { redactor },
            ),
          ],
        }
      },
    },
  }
  const manifest = makeManifest([
    {
      id: 'ext',
      name: 'Ext',
      evidenceClass: 'external',
      executor: 'external',
      target: 'example.test',
    },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard: createGuard({ allow: ['example.test'] }),
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.PASS)
})

test('PASS asserted without a receipt is rejected (fake-success guard)', async () => {
  const executors = {
    liar: {
      async run() {
        return { status: STATUS.PASS, receipts: [] }
      },
    },
  }
  const manifest = makeManifest([
    { id: 'fake', name: 'Fake', evidenceClass: 'unit', executor: 'liar' },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.FAIL)
  assert.match(run.entries[0].detail, /fake-success guard/)
})

test('a receipt with a broken self-hash is rejected', async () => {
  const tampered = JSON.parse(JSON.stringify(makeReceipt({ evidenceClass: 'unit', redactor })))
  tampered.receiptSha256 = '0'.repeat(64)
  const executors = {
    broken: {
      async run() {
        return { status: STATUS.PASS, receipts: [tampered] }
      },
    },
  }
  const manifest = makeManifest([
    { id: 'broken', name: 'Broken', evidenceClass: 'unit', executor: 'broken' },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.FAIL)
  assert.match(run.entries[0].detail, /SHA-256 integrity/)
})

test('an executor that returns no valid status FAILs', async () => {
  const executors = {
    weird: {
      async run() {
        return { status: 'GREEN', receipts: [] }
      },
    },
  }
  const manifest = makeManifest([
    { id: 'weird', name: 'Weird', evidenceClass: 'unit', executor: 'weird' },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.FAIL)
  assert.match(run.entries[0].detail, /no valid status/)
})

test('a precondition error becomes BLOCKED, never a fake PASS', async () => {
  const executors = {
    precondition: {
      async run() {
        throw new PreconditionError('no disposable target configured')
      },
    },
  }
  const manifest = makeManifest([
    { id: 'pre', name: 'Pre', evidenceClass: 'protocol', executor: 'precondition' },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.BLOCKED)
})

test('a failed dependency blocks dependants', async () => {
  const executors = {
    fail: {
      async run() {
        return { status: STATUS.FAIL, detail: 'boom' }
      },
    },
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([
    { id: 'a', name: 'A', evidenceClass: 'unit', executor: 'fail' },
    { id: 'b', name: 'B', evidenceClass: 'unit', executor: 'ok', dependsOn: ['a'] },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.FAIL)
  assert.equal(run.entries[1].status, STATUS.BLOCKED)
  assert.equal(run.status, STATUS.FAIL)
})

test('disabled entries report NOT_RUN', async () => {
  const executors = {
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([
    { id: 'off', name: 'Off', evidenceClass: 'unit', executor: 'ok', enabled: false },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.entries[0].status, STATUS.NOT_RUN)
})

test('non allow-listed targets are rejected before execution', async () => {
  const executors = {
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([
    {
      id: 'remote',
      name: 'Remote',
      evidenceClass: 'unit',
      executor: 'ok',
      target: 'some-random-public-host.net',
    },
  ])
  await assert.rejects(
    runManifest(manifest, { registry: createStubRegistry(executors), guard, redactor }),
    ManifestError,
  )
})

test('timeout aborts the executor signal and reports FAIL', async () => {
  let aborted = false
  const executors = {
    hang: {
      async run(ctx) {
        return new Promise((resolve) => {
          ctx.signal.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve({ status: STATUS.PASS, receipts: [] })
            },
            { once: true },
          )
        })
      },
    },
  }
  const manifest = makeManifest([
    { id: 'hang', name: 'Hang', evidenceClass: 'unit', executor: 'hang', timeoutMs: 25 },
  ])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
    defaultTimeoutMs: 25,
  })
  assert.equal(run.entries[0].status, STATUS.FAIL)
  assert.match(run.entries[0].detail, /exceeded/)
  assert.equal(aborted, true)
})

test('runManifest refuses a manifest containing a production endpoint', async () => {
  const manifest = makeManifest([
    {
      id: 'prod',
      name: 'Prod',
      evidenceClass: 'protocol',
      executor: 'protocol.smtp-banner',
      target: 'mail.production.example.invalid',
    },
  ])
  await assert.rejects(
    runManifest(manifest, { registry: createStubRegistry({}), guard, redactor }),
    ManifestError,
  )
})

test('a successful run records correlation ids and receipt hashes', async () => {
  const executors = {
    ok: {
      async run() {
        return { status: STATUS.PASS, receipts: [makeReceipt({ evidenceClass: 'unit', redactor })] }
      },
    },
  }
  const manifest = makeManifest([{ id: 'a', name: 'A', evidenceClass: 'unit', executor: 'ok' }])
  const run = await runManifest(manifest, {
    registry: createStubRegistry(executors),
    guard,
    redactor,
  })
  assert.equal(run.receipts.length, 1)
  assert.equal(run.receipts[0].receiptSha256.length, 64)
  assert.match(run.entries[0].correlationId, /^a-/)
})

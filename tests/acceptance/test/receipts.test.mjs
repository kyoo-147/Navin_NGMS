import test from 'node:test'
import assert from 'node:assert/strict'
import { isCorrelationId, isIsoTimestamp } from '../src/ids.mjs'
import { createRedactor } from '../src/redaction.mjs'
import {
  browserReceipt,
  commandReceipt,
  desktopReceipt,
  externalReceipt,
  protocolReceipt,
  sealReceipt,
  verifyReceiptHash,
} from '../src/receipts.mjs'
import { STATUS } from '../src/status.mjs'

const redactor = createRedactor()
const now = () => new Date().toISOString()

test('sealReceipt stamps schema, correlation ids and timestamps', () => {
  const receipt = sealReceipt(
    {
      kind: 'command',
      evidenceClass: 'integration',
      status: STATUS.PASS,
      correlationId: 'entry-11111111-1111-1111-1111-111111111111',
      payload: { argv: ['x'] },
    },
    { redactor },
  )
  assert.equal(receipt.schemaVersion, 1)
  assert.ok(isIsoTimestamp(receipt.createdAt))
  assert.ok(isIsoTimestamp(receipt.startedAt))
  assert.ok(isIsoTimestamp(receipt.finishedAt))
  assert.ok(isCorrelationId(receipt.receiptId))
  assert.ok(verifyReceiptHash(receipt))
})

test('receipt hash changes when payload changes', () => {
  const startedAt = now()
  const finishedAt = now()
  const correlationId = 'entry-22222222-2222-2222-2222-222222222222'
  const a = commandReceipt(
    { argv: ['a'], stdout: 'one', status: STATUS.PASS, startedAt, finishedAt, correlationId },
    { redactor },
  )
  const b = commandReceipt(
    { argv: ['a'], stdout: 'two', status: STATUS.PASS, startedAt, finishedAt, correlationId },
    { redactor },
  )
  assert.notEqual(a.receiptSha256, b.receiptSha256)
  assert.ok(verifyReceiptHash(b))
})

test('command receipt redacts stdout and records hashes', () => {
  const receipt = commandReceipt(
    {
      argv: [
        'curl',
        '-H',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk',
      ],
      stdout: 'password=hunter2\n',
      status: STATUS.PASS,
      startedAt: now(),
      finishedAt: now(),
    },
    { redactor },
  )
  assert.ok(!JSON.stringify(receipt.payload).includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'))
  assert.ok(!JSON.stringify(receipt.payload).includes('hunter2'))
  assert.match(receipt.payload.stdout, /\[REDACTED/)
  assert.equal(receipt.payload.stdoutSha256.length, 64)
  assert.equal(receipt.evidenceClass, 'integration')
  assert.equal(receipt.redaction.applied, true)
})

test('each receipt kind reports its declared evidence class', () => {
  const base = { status: STATUS.PASS, startedAt: now(), finishedAt: now() }
  assert.equal(
    protocolReceipt({ ...base, protocol: 'smtp' }, { redactor }).evidenceClass,
    'protocol',
  )
  assert.equal(
    browserReceipt({ ...base, url: 'http://localhost' }, { redactor }).evidenceClass,
    'browser',
  )
  assert.equal(
    desktopReceipt({ ...base, artifactName: 'navin.exe' }, { redactor }).evidenceClass,
    'desktop',
  )
  assert.equal(
    externalReceipt({ ...base, domain: 'example.test' }, { redactor }).evidenceClass,
    'external',
  )
})

test('protocol transcript is redacted and hashed', () => {
  const receipt = protocolReceipt(
    {
      protocol: 'smtp',
      transcript: '220 mail.example.test\r\n250-AUTH\r\nTOKEN=abc123SECRETvalue\r\n',
      status: STATUS.PASS,
      startedAt: now(),
      finishedAt: now(),
    },
    { redactor },
  )
  assert.ok(!receipt.payload.transcript.includes('abc123SECRETvalue'))
  assert.equal(receipt.payload.transcriptSha256.length, 64)
})

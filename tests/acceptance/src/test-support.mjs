import { commandReceipt } from './receipts.mjs'
import { STATUS } from './status.mjs'

export function createStubRegistry(executors) {
  const map = new Map(Object.entries(executors))
  return {
    has: (name) => map.has(name),
    get: (name) => map.get(name),
    names: () => [...map.keys()].sort(),
    list: () =>
      [...map.entries()].map(([name, executor]) => ({
        name,
        evidenceClass: executor.evidenceClass ?? null,
        description: executor.description ?? null,
      })),
  }
}

export function makeReceipt({
  evidenceClass = 'unit',
  status = STATUS.PASS,
  argv = ['stub'],
  redactor,
  correlationId,
  target = null,
  receiptId,
} = {}) {
  return commandReceipt(
    {
      argv,
      exitCode: status === STATUS.PASS ? 0 : 1,
      stdout: 'stub-evidence',
      startedAt: new Date(Date.now() - 1).toISOString(),
      finishedAt: new Date().toISOString(),
      status,
      evidenceClass,
      correlationId,
      target,
      receiptId,
    },
    { redactor },
  )
}

export function makeManifest(entries, overrides = {}) {
  return { manifestVersion: 1, name: 'test-manifest', entries, ...overrides }
}

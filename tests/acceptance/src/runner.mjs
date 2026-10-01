import { canSatisfy, isEvidenceClass } from './classes.mjs'
import { ExecutorTimeoutError, PreconditionError } from './errors.mjs'
import { GuardError } from './guard.mjs'
import { correlationId, durationMs, newRunId, nowIso } from './ids.mjs'
import {
  assertValidManifest,
  manifestHash,
  orderEntries,
  resolveEffectiveTarget,
} from './manifest.mjs'
import { verifyReceiptHash } from './receipts.mjs'
import { STATUS, aggregateStatus, isStatus } from './status.mjs'

export const RUN_SCHEMA_VERSION = 1

async function runWithTimeout(run, ms, label, controller) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ExecutorTimeoutError(`executor ${label} exceeded ${ms}ms`))
    }, ms)
  })
  const work = Promise.resolve().then(run)
  work.catch(() => {})
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function classifyError(error) {
  if (error instanceof GuardError) {
    return { status: STATUS.BLOCKED, detail: error.message }
  }
  if (error instanceof PreconditionError) {
    return { status: STATUS.BLOCKED, detail: error.message }
  }
  if (error instanceof ExecutorTimeoutError) {
    return { status: STATUS.FAIL, detail: error.message }
  }
  return {
    status: STATUS.FAIL,
    detail: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
  }
}

function dependencyOutcome(entry, results) {
  for (const dependency of entry.dependsOn ?? []) {
    const result = results.get(dependency)
    if (!result) {
      return { status: STATUS.BLOCKED, detail: `dependency not evaluated: ${dependency}` }
    }
    if (result.status === STATUS.FAIL) {
      return { status: STATUS.BLOCKED, detail: `dependency failed: ${dependency}` }
    }
    if (result.status === STATUS.BLOCKED) {
      return { status: STATUS.BLOCKED, detail: `dependency blocked: ${dependency}` }
    }
    if (result.status === STATUS.NOT_RUN) {
      return { status: STATUS.NOT_RUN, detail: `dependency not run: ${dependency}` }
    }
  }
  return null
}

function validatePassEvidence(entry, receipts) {
  if (receipts.length === 0) {
    return 'PASS asserted without a receipt (fake-success guard)'
  }
  for (const receipt of receipts) {
    if (!verifyReceiptHash(receipt)) {
      return `receipt ${receipt.receiptId} failed its own SHA-256 integrity check`
    }
    if (receipt.status !== STATUS.PASS) {
      return `receipt ${receipt.receiptId} status ${receipt.status} contradicts PASS entry`
    }
    if (
      !isEvidenceClass(receipt.evidenceClass) ||
      !canSatisfy(receipt.evidenceClass, entry.evidenceClass)
    ) {
      return `insufficient evidence class: ${receipt.evidenceClass} cannot satisfy ${entry.evidenceClass}`
    }
  }
  return null
}

export async function runManifest(manifest, options = {}) {
  const {
    registry,
    guard,
    redactor,
    defaultTimeoutMs = 60000,
    logger = () => {},
    now = () => new Date(),
  } = options

  if (!registry || typeof registry.get !== 'function') {
    throw new TypeError('runManifest requires a registry')
  }
  if (!guard || typeof guard.checkTarget !== 'function') {
    throw new TypeError('runManifest requires a guard')
  }
  if (!redactor || typeof redactor.redactText !== 'function') {
    throw new TypeError('runManifest requires a redactor')
  }

  assertValidManifest(manifest, { guard, registry })

  const hash = manifestHash(manifest)
  const runId = newRunId(hash, now())
  const startedAt = nowIso()
  const ordered = orderEntries(manifest.entries)
  const results = new Map()
  const entryRecords = []
  const receiptsById = new Map()

  const safeText = (value) =>
    value === undefined || value === null ? null : redactor.redactText(String(value)).text

  function record(entry, recordInput) {
    const finishedAt = recordInput.finishedAt ?? nowIso()
    const entryStartedAt = recordInput.startedAt ?? finishedAt
    const receipts = recordInput.receipts ?? []
    for (const receipt of receipts) {
      receiptsById.set(receipt.receiptId, receipt)
    }
    const recordValue = {
      id: entry.id,
      name: entry.name,
      evidenceClass: entry.evidenceClass,
      executor: entry.executor,
      required: entry.required !== false,
      target: entry.target ?? null,
      claim: entry.claim ?? null,
      status: recordInput.status,
      correlationId: recordInput.correlationId,
      startedAt: entryStartedAt,
      finishedAt,
      durationMs: durationMs(entryStartedAt, finishedAt),
      detail: safeText(recordInput.detail),
      params: redactor.redactValue(entry.params ?? {}).value,
      receiptIds: receipts.map((receipt) => receipt.receiptId),
    }
    entryRecords.push(recordValue)
    results.set(entry.id, { status: recordInput.status })
    logger({ type: 'entry', id: entry.id, status: recordInput.status, detail: recordValue.detail })
  }

  for (const entry of ordered) {
    const cid = correlationId(entry.id)
    const entryStartedAt = nowIso()

    if (entry.enabled === false) {
      record(entry, {
        status: STATUS.NOT_RUN,
        correlationId: cid,
        startedAt: entryStartedAt,
        detail: 'disabled in manifest',
      })
      continue
    }

    if (!registry.has(entry.executor)) {
      const required = entry.required !== false
      record(entry, {
        status: required ? STATUS.BLOCKED : STATUS.NOT_RUN,
        correlationId: cid,
        startedAt: entryStartedAt,
        detail: `executor not registered: ${entry.executor}`,
      })
      continue
    }

    const { effective: effectiveTarget } = resolveEffectiveTarget(entry, registry)
    const targetCheck = guard.checkTarget(effectiveTarget ?? entry.target)
    if (!targetCheck.allowed) {
      record(entry, {
        status: STATUS.BLOCKED,
        correlationId: cid,
        startedAt: entryStartedAt,
        detail: targetCheck.reason,
      })
      continue
    }

    const dependency = dependencyOutcome(entry, results)
    if (dependency) {
      record(entry, {
        status: dependency.status,
        correlationId: cid,
        startedAt: entryStartedAt,
        detail: dependency.detail,
      })
      continue
    }

    const executor = registry.get(entry.executor)
    const timeoutMs = Number.isFinite(entry.timeoutMs) ? entry.timeoutMs : defaultTimeoutMs
    const controller = new AbortController()
    let outcome
    try {
      const ctx = {
        entry,
        params: entry.params ?? {},
        target: effectiveTarget ?? entry.target ?? null,
        entryTarget: entry.target ?? null,
        guard,
        redactor,
        correlationId: cid,
        timeoutMs,
        cwd: options.cwd,
        signal: controller.signal,
      }
      const result = await runWithTimeout(
        () => executor.run(ctx),
        timeoutMs,
        entry.executor,
        controller,
      )
      const receipts = Array.isArray(result?.receipts) ? result.receipts : []
      let status = result?.status
      let detail = result?.detail ?? null
      if (!isStatus(status)) {
        status = STATUS.FAIL
        detail = `executor returned no valid status: ${JSON.stringify(result?.status ?? null)}`
      } else if (status === STATUS.PASS) {
        const violation = validatePassEvidence(entry, receipts)
        if (violation) {
          status = STATUS.FAIL
          detail = violation
        }
      }
      outcome = { status, detail, receipts, startedAt: entryStartedAt, finishedAt: nowIso() }
    } catch (error) {
      const classified = classifyError(error)
      outcome = {
        status: classified.status,
        detail: classified.detail,
        receipts: [],
        startedAt: entryStartedAt,
        finishedAt: nowIso(),
      }
    }

    record(entry, { ...outcome, correlationId: cid })
  }

  const finishedAt = nowIso()
  const totals = {
    total: entryRecords.length,
    [STATUS.PASS]: entryRecords.filter((entry) => entry.status === STATUS.PASS).length,
    [STATUS.FAIL]: entryRecords.filter((entry) => entry.status === STATUS.FAIL).length,
    [STATUS.BLOCKED]: entryRecords.filter((entry) => entry.status === STATUS.BLOCKED).length,
    [STATUS.NOT_RUN]: entryRecords.filter((entry) => entry.status === STATUS.NOT_RUN).length,
  }

  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId,
    manifestName: manifest.name,
    manifestHash: hash,
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
    status: aggregateStatus(entryRecords.map((entry) => entry.status)),
    totals,
    entries: entryRecords,
    receipts: [...receiptsById.values()],
  }
}

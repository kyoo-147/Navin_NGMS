import { randomUUID } from 'node:crypto'

export function nowIso() {
  return new Date().toISOString()
}

export function correlationId(prefix = 'corr') {
  const safePrefix =
    String(prefix ?? 'corr')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 48) || 'corr'
  return `${safePrefix}-${randomUUID()}`
}

export function newRunId(manifestHash, at = new Date()) {
  const stamp = at
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)
  const hash = String(manifestHash ?? '').slice(0, 12)
  return `run-${stamp}-${hash}`
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const CORRELATION_PATTERN = /^[A-Za-z0-9._-]{1,48}-[0-9a-fA-F-]{36}$/

export function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

export function isCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_PATTERN.test(value)
}

export function durationMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt)
  const finish = Date.parse(finishedAt)
  if (Number.isNaN(start) || Number.isNaN(finish)) {
    return null
  }
  return Math.max(0, finish - start)
}

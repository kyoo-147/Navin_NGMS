import { describe, expect, it } from 'vitest'
import { JsonLogger } from '../src/adapters/json-logger.js'
import { runWithCorrelation } from '../src/correlation/context.js'
import { REDACTED } from '../src/logging/redact.js'
import { CaptureSink, FixedClock } from './support/test-helpers.js'

function createLogger(
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' = 'info',
  redactLiterals: readonly string[] = [],
) {
  const sink = new CaptureSink()
  const clock = new FixedClock()
  const logger = new JsonLogger({
    level,
    clock,
    sink,
    redactLiterals,
    base: { service: 'navind' },
  })
  return { sink, clock, logger }
}

describe('JsonLogger', () => {
  it('emits structured JSON with base fields and timestamp', () => {
    const { sink, logger } = createLogger()
    logger.info('hello', { extra: 1 })

    expect(sink.records()).toHaveLength(1)
    const record = sink.records()[0] as Record<string, unknown>
    expect(record.level).toBe('info')
    expect(record.msg).toBe('hello')
    expect(record.service).toBe('navind')
    expect(record.extra).toBe(1)
    expect(record.time).toBe('2026-10-01T00:00:00.000Z')
  })

  it('filters records below the configured level', () => {
    const { sink, logger } = createLogger('warn')
    logger.debug('hidden')
    logger.info('hidden')
    logger.warn('shown')
    logger.error('shown')

    expect(sink.records().map((record) => record.msg)).toEqual(['shown', 'shown'])
    expect(logger.isLevelEnabled('debug')).toBe(false)
    expect(logger.isLevelEnabled('error')).toBe(true)
  })

  it('merges child bindings', () => {
    const { sink, logger } = createLogger()
    logger.child({ component: 'kernel' }).info('child')
    const record = sink.records()[0] as Record<string, unknown>
    expect(record.component).toBe('kernel')
    expect(record.service).toBe('navind')
  })

  it('redacts sensitive fields', () => {
    const { sink, logger } = createLogger()
    logger.info('secrets', { password: 'hunter2', apiKey: 'abc', keep: 'ok' })
    const record = sink.records()[0] as Record<string, unknown>
    expect(record.password).toBe(REDACTED)
    expect(record.apiKey).toBe(REDACTED)
    expect(record.keep).toBe('ok')
  })

  it('adds the correlation id from the async context', () => {
    const { sink, logger } = createLogger()
    runWithCorrelation({ correlationId: 'cor_123' }, () => logger.info('scoped'))
    const record = sink.records()[0] as Record<string, unknown>
    expect(record.correlationId).toBe('cor_123')
  })

  it('serializes errors without throwing', () => {
    const { sink, logger } = createLogger()
    logger.error('failed', { err: new Error('boom') })
    const record = sink.records()[0] as Record<string, unknown>
    expect((record.err as Record<string, unknown>).message).toBe('boom')
  })
})

describe('JsonLogger adversarial redaction', () => {
  it('masks credentials embedded in messages and field values', () => {
    const { sink, logger } = createLogger('info', ['super-secret-value'])
    logger.info('leaked super-secret-value', {
      header: 'Authorization: Bearer abc.def.ghi',
      query: 'token=abc123secret',
    })

    const dumped = sink.lines.join('\n')
    expect(dumped).not.toContain('super-secret-value')
    expect(dumped).not.toContain('abc.def.ghi')
    expect(dumped).not.toContain('abc123secret')
    expect(dumped).toContain(REDACTED)
  })

  it('masks secrets inside error messages and stacks', () => {
    const { sink, logger } = createLogger('info', ['super-secret-value'])
    logger.error('failed', { err: new Error('password=hunter2 super-secret-value') })

    const dumped = sink.lines.join('\n')
    expect(dumped).not.toContain('hunter2')
    expect(dumped).not.toContain('super-secret-value')
  })

  it('masks a JWT passed as a field value', () => {
    const { sink, logger } = createLogger()
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    logger.info('auth', { value: jwt })
    expect(sink.lines.join('\n')).not.toContain(jwt)
  })
})

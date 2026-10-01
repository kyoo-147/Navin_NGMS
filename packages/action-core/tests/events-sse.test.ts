import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActionCore, REDACTED, formatSseFrame, parseLastEventId } from '../src/index.js'
import type { StoredEvent } from '../src/index.js'
import { createTempDir, openCore, removeTempDir } from './helpers.js'

describe('event log and SSE replay', () => {
  let dir: string
  let core: ActionCore

  beforeEach(() => {
    dir = createTempDir()
    core = openCore(dir)
  })

  afterEach(() => {
    core.close()
    removeTempDir(dir)
  })

  it('assigns a monotonic durable cursor and exposes it as metadata', () => {
    const first = core.events.append({ kind: 'job.running', channel: 'jobs' })
    const second = core.events.append({ kind: 'job.progress', channel: 'jobs' })
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(first.event.metadata?.cursor).toBe(String(first.seq))
    expect(core.events.latestCursor()).toBe(second.seq)
  })

  it('redacts event data payloads', () => {
    const stored = core.events.append({
      kind: 'job.progress',
      channel: 'jobs',
      data: { apiToken: 'secret-value', step: 'sync' },
    })
    expect(stored.event.payload.data?.apiToken).toBe(REDACTED)
    expect(stored.event.payload.data?.step).toBe('sync')
  })

  it('is append-only', () => {
    const stored = core.events.append({ kind: 'job.running', channel: 'jobs' })
    expect(() =>
      core.db.prepare('UPDATE events SET kind = ? WHERE id = ?').run('x', stored.event.id),
    ).toThrowError(/append-only/)
    expect(() =>
      core.db.prepare('DELETE FROM events WHERE id = ?').run(stored.event.id),
    ).toThrowError(/append-only/)
  })

  it('replays only events after the Last-Event-ID cursor', () => {
    const a = core.events.append({ kind: 'e1', channel: 'jobs' })
    core.events.append({ kind: 'e2', channel: 'jobs' })
    const c = core.events.append({ kind: 'e3', channel: 'jobs' })

    const replayed = core.events.readSince('jobs', a.seq, 100)
    expect(replayed.map((entry) => entry.event.kind)).toEqual(['e2', 'e3'])

    const frames = core.eventStream.replay({ channel: 'jobs', lastEventId: a.seq })
    expect(frames.map((frame) => frame.id)).toEqual([String(a.seq + 1), String(c.seq)])
  })

  it('formats SSE frames and parses Last-Event-ID', () => {
    expect(parseLastEventId(undefined)).toBe(0)
    expect(parseLastEventId('')).toBe(0)
    expect(parseLastEventId('garbage')).toBe(0)
    expect(parseLastEventId('42')).toBe(42)

    const stored = core.events.append({ kind: 'job.running', channel: 'jobs' })
    const frame = formatSseFrame(stored, 5000)
    expect(frame).toContain(`id: ${stored.seq}`)
    expect(frame).toContain('event: job.running')
    expect(frame).toContain('retry: 5000')
    expect(frame.endsWith('\n\n')).toBe(true)
  })

  it('replays missed events then streams live events without duplicates', () => {
    const first = core.events.append({ kind: 'e1', channel: 'jobs' })
    const received: StoredEvent[] = []
    const unsubscribe = core.eventStream.connect({
      channel: 'jobs',
      lastEventId: first.seq - 1,
      onEvent: (_frame, event) => received.push(event),
    })

    const live = core.events.append({ kind: 'e2', channel: 'jobs' })
    core.events.append({ kind: 'other', channel: 'audit' })
    unsubscribe()

    expect(received.map((entry) => entry.seq)).toEqual([first.seq, live.seq])
    expect(received.find((entry) => entry.event.payload.channel !== 'jobs')).toBeUndefined()
  })

  it('discards live notifications for rolled-back transactions', () => {
    const received: StoredEvent[] = []
    const unsubscribe = core.eventStream.connect({
      onEvent: (_frame, event) => received.push(event),
    })

    expect(() =>
      core.db.transaction(() => {
        core.events.append({ kind: 'should_roll_back', channel: 'system' })
        throw new Error('boom')
      }),
    ).toThrow('boom')

    unsubscribe()
    expect(received).toHaveLength(0)
    expect(core.events.count()).toBe(0)
  })

  it('discards afterCommit notifications queued inside a rolled-back nested savepoint', () => {
    const received: StoredEvent[] = []
    const unsubscribe = core.eventStream.connect({
      onEvent: (_frame, event) => received.push(event),
    })

    core.db.transaction(() => {
      try {
        core.db.transaction(() => {
          core.events.append({ kind: 'inner.rolled_back', channel: 'system' })
          throw new Error('inner')
        })
      } catch {
        // Swallow the nested failure; the outer transaction still commits.
      }
    })

    unsubscribe()
    expect(received).toHaveLength(0)
    expect(core.events.count()).toBe(0)
  })

  it('delivers afterCommit notifications for committed nested savepoints', () => {
    const received: StoredEvent[] = []
    const unsubscribe = core.eventStream.connect({
      onEvent: (_frame, event) => received.push(event),
    })

    core.db.transaction(() => {
      core.db.transaction(() => {
        core.events.append({ kind: 'inner.committed', channel: 'system' })
      })
    })

    unsubscribe()
    expect(received.map((entry) => entry.event.kind)).toEqual(['inner.committed'])
    expect(core.events.count()).toBe(1)
  })
})

import {
  BackgroundEventPayloadSchema,
  BackgroundEventSchema,
  type BackgroundEvent,
  type BackgroundEventPayload,
  type EventChannel,
  type JobProgress,
  type JobStatus,
} from '@navin/contracts'

import { nowIso, type Clock } from '../clock.js'
import { parseJson, stringifyJson } from '../json.js'
import { redact, redactRecord } from '../redaction.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

export interface AppendEventInput {
  kind: string
  channel: EventChannel
  id?: string
  jobId?: string
  actionId?: string
  sessionId?: string
  status?: JobStatus
  progress?: JobProgress
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  timestamp?: string
}

export interface StoredEvent {
  /** Monotonic, durable cursor. Doubles as the SSE `Last-Event-ID`. */
  seq: number
  event: BackgroundEvent
}

export interface EventLogDeps {
  ids: IdFactory
  clock: Clock
}

interface EventRow {
  seq: number | bigint
  id: string
  kind: string
  channel: string
  timestamp: string
  job_id: string | null
  action_id: string | null
  session_id: string | null
  status: string | null
  progress: string | null
  data: string | null
  metadata: string | null
}

type EventListener = (event: StoredEvent) => void

function toStoredEvent(row: EventRow): StoredEvent {
  const seq = Number(row.seq)
  const payload: BackgroundEventPayload = { channel: row.channel as EventChannel }
  if (row.job_id !== null) {
    payload.jobId = row.job_id
  }
  if (row.status !== null) {
    payload.status = row.status as JobStatus
  }
  const progress = parseJson<JobProgress>(row.progress)
  if (progress !== undefined) {
    payload.progress = progress
  }
  const data = parseJson<Record<string, unknown>>(row.data)
  if (data !== undefined) {
    payload.data = data
  }

  const metadata: Record<string, unknown> = parseJson<Record<string, unknown>>(row.metadata) ?? {}
  if (row.action_id !== null) {
    metadata.actionId = row.action_id
  }
  if (row.session_id !== null) {
    metadata.sessionId = row.session_id
  }
  metadata.cursor = String(seq)

  return {
    seq,
    event: {
      apiVersion: '1',
      kind: row.kind,
      id: row.id,
      timestamp: row.timestamp,
      payload,
      metadata,
    },
  }
}

/**
 * Append-only event log. Rows are written once and never updated or deleted
 * (enforced by database triggers). `seq` is a durable, monotonic cursor used for
 * SSE reconnect/replay.
 */
export class EventLog {
  private readonly listeners = new Set<EventListener>()

  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: EventLogDeps,
  ) {}

  append(input: AppendEventInput): StoredEvent {
    const id = input.id ?? this.deps.ids('evt')
    const timestamp = input.timestamp ?? nowIso(this.deps.clock)
    const progress = input.progress === undefined ? undefined : redact(input.progress)
    const data = redactRecord(input.data)
    const metadata = redactRecord(input.metadata)

    const payload: BackgroundEventPayload = { channel: input.channel }
    if (input.jobId !== undefined) {
      payload.jobId = input.jobId
    }
    if (input.status !== undefined) {
      payload.status = input.status
    }
    if (progress !== undefined) {
      payload.progress = progress
    }
    if (data !== undefined) {
      payload.data = data
    }
    assertContract(BackgroundEventPayloadSchema, payload, 'background event payload')

    const inserted = this.db
      .prepare(
        `INSERT INTO events
           (id, api_version, kind, channel, timestamp, job_id, action_id, session_id, status, progress, data, metadata)
         VALUES (?, '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING seq`,
      )
      .get(
        id,
        input.kind,
        input.channel,
        timestamp,
        input.jobId ?? null,
        input.actionId ?? null,
        input.sessionId ?? null,
        input.status ?? null,
        progress === undefined ? null : stringifyJson(progress),
        data === undefined ? null : stringifyJson(data),
        metadata === undefined ? null : stringifyJson(metadata),
      ) as { seq: number | bigint }

    const stored = toStoredEvent({
      seq: inserted.seq,
      id,
      kind: input.kind,
      channel: input.channel,
      timestamp,
      job_id: input.jobId ?? null,
      action_id: input.actionId ?? null,
      session_id: input.sessionId ?? null,
      status: input.status ?? null,
      progress: progress === undefined ? null : stringifyJson(progress),
      data: data === undefined ? null : stringifyJson(data),
      metadata: metadata === undefined ? null : stringifyJson(metadata),
    })
    assertContract(BackgroundEventSchema, stored.event, 'background event envelope')

    this.db.afterCommit(() => this.notify(stored))
    return stored
  }

  appendMany(inputs: AppendEventInput[]): StoredEvent[] {
    return inputs.map((input) => this.append(input))
  }

  get(seq: number): StoredEvent | undefined {
    const row = this.db.prepare('SELECT * FROM events WHERE seq = ?').get(seq) as
      EventRow | undefined
    return row === undefined ? undefined : toStoredEvent(row)
  }

  readSince(channel: EventChannel | undefined, cursor: number, limit = 500): StoredEvent[] {
    const bounded = Math.max(1, Math.trunc(limit))
    const rows = (channel === undefined
      ? this.db
          .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?')
          .all(cursor, bounded)
      : this.db
          .prepare('SELECT * FROM events WHERE seq > ? AND channel = ? ORDER BY seq ASC LIMIT ?')
          .all(cursor, channel, bounded)) as unknown as EventRow[]
    return rows.map(toStoredEvent)
  }

  readForJob(jobId: string, cursor = 0, limit = 500): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE job_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(jobId, cursor, Math.max(1, Math.trunc(limit))) as unknown as EventRow[]
    return rows.map(toStoredEvent)
  }

  latestCursor(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS seq FROM events').get() as
      { seq: number | bigint | null } | undefined
    return row?.seq === undefined || row.seq === null ? 0 : Number(row.seq)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM events').get() as {
      total: number | bigint
    }
    return Number(row.total)
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(event: StoredEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

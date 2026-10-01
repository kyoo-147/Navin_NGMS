import type { EventChannel } from '@navin/contracts'

import type { EventLog, StoredEvent } from '../ledger/event-log.js'

export interface SseFrame {
  id: string
  event: string
  data: string
  retry?: number
}

export function parseLastEventId(header: string | null | undefined): number {
  if (header === null || header === undefined || header === '') {
    return 0
  }
  const parsed = Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function formatSseFrame(stored: StoredEvent, retryMs?: number): string {
  const lines = [
    `id: ${stored.seq}`,
    `event: ${stored.event.kind}`,
    `data: ${JSON.stringify(stored.event)}`,
  ]
  if (retryMs !== undefined) {
    lines.push(`retry: ${retryMs}`)
  }
  return `${lines.join('\n')}\n\n`
}

export interface ReplayOptions {
  channel?: EventChannel
  lastEventId?: number | string
  limit?: number
}

export interface ConnectOptions extends ReplayOptions {
  onEvent: (frame: string, event: StoredEvent) => void
}

/**
 * SSE bridge over the durable event log.
 *
 * Reconnect uses the `Last-Event-ID` cursor (the event `seq`): the server replays
 * every event after that cursor from SQLite, then streams live events. Live events
 * are de-duplicated by seq so a replayed event is never delivered twice.
 */
export class EventStream {
  constructor(private readonly events: EventLog) {}

  replay(options: ReplayOptions = {}): SseFrame[] {
    const cursor = parseLastEventId(
      options.lastEventId === undefined ? undefined : String(options.lastEventId),
    )
    const events = this.events.readSince(options.channel, cursor, options.limit ?? 500)
    return events.map((stored) => ({
      id: String(stored.seq),
      event: stored.event.kind,
      data: JSON.stringify(stored.event),
    }))
  }

  connect(options: ConnectOptions): () => void {
    const cursor = parseLastEventId(
      options.lastEventId === undefined ? undefined : String(options.lastEventId),
    )
    const replayed = this.events.readSince(options.channel, cursor, options.limit ?? 500)
    let lastSeq = cursor
    for (const stored of replayed) {
      lastSeq = stored.seq
      options.onEvent(formatSseFrame(stored), stored)
    }

    return this.events.subscribe((stored) => {
      if (options.channel !== undefined && stored.event.payload.channel !== options.channel) {
        return
      }
      if (stored.seq <= lastSeq) {
        return
      }
      lastSeq = stored.seq
      options.onEvent(formatSseFrame(stored), stored)
    })
  }

  heartbeat(): string {
    return ': keep-alive\n\n'
  }
}

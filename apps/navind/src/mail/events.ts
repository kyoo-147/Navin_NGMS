import type { BackgroundEvent } from '@navin/contracts'
import type { Clock } from '../ports/clock.js'

export interface StoredMailEvent {
  seq: number
  event: BackgroundEvent
}

/**
 * In-process, bounded event stream for the Mail surface.
 *
 * Events are truthful acknowledgements of completed server operations — a
 * mutation or submission that actually succeeded — never optimistic
 * placeholders.
 *
 * The history is a fixed-size ring held in this process only. `Last-Event-ID`
 * resumes a reconnect *within the same process*; after a daemon restart the
 * sequence restarts and a client must reconcile from authoritative state (an
 * id may even refer to a different event). Do not treat the stream as durable
 * or restart-resumable.
 */
export class MailEventBus {
  private seq = 0
  private readonly history: StoredMailEvent[] = []
  private readonly listeners = new Set<(stored: StoredMailEvent) => void>()

  constructor(
    private readonly clock: Clock,
    private readonly maxHistory = 512,
  ) {}

  publish(kind: string, data: Record<string, unknown>): StoredMailEvent {
    this.seq += 1
    const event: BackgroundEvent = {
      apiVersion: '1',
      kind,
      id: `mlev_${this.seq}_${Date.now().toString(36)}`,
      timestamp: this.clock.nowIso(),
      payload: { channel: 'mail', data },
    }
    const stored: StoredMailEvent = { seq: this.seq, event }
    this.history.push(stored)
    if (this.history.length > this.maxHistory) this.history.shift()
    for (const listener of this.listeners) listener(stored)
    return stored
  }

  eventsSince(cursor: number): StoredMailEvent[] {
    return this.history.filter((stored) => stored.seq > cursor)
  }

  subscribe(listener: (stored: StoredMailEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get lastSeq(): number {
    return this.seq
  }
}

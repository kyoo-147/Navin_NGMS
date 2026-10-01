export type RealtimeEventType =
  'sync_started' | 'sync_completed' | 'new_email' | 'mailbox_updated' | 'error'

export interface RealtimeEvent {
  type: RealtimeEventType
  accountId: string
  payload?: unknown
  error?: string
  timestamp: string
}

export type RealtimeListener = (event: RealtimeEvent) => void

export interface RealtimeSyncOptions {
  pollIntervalMs?: number
  onPoll?: (accountId: string) => Promise<void>
}

/**
 * Manages realtime sync events, state change deduplication, and periodic polling.
 */
export class RealtimeSyncManager {
  private readonly listeners = new Set<RealtimeListener>()
  private readonly lastKnownStates = new Map<string, string>()
  private pollTimer: NodeJS.Timeout | number | null = null
  private readonly pollIntervalMs: number
  private readonly onPoll?: (accountId: string) => Promise<void>
  private activeAccounts = new Set<string>()

  constructor(options: RealtimeSyncOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000
    this.onPoll = options.onPoll
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: RealtimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Prevent listener error from interrupting dispatch
      }
    }
  }

  /**
   * Called when an external event source, SSE, or webhook pushes a new state string.
   * Deduplicates events: only triggers sync if state has actually advanced.
   */
  handleStateNotification(accountId: string, newState: string): boolean {
    const previous = this.lastKnownStates.get(accountId)
    if (previous === newState) {
      // Deduplicate: same state, do not trigger redundant sync
      return false
    }

    this.lastKnownStates.set(accountId, newState)
    this.emit({
      type: 'mailbox_updated',
      accountId,
      payload: { newState },
      timestamp: new Date().toISOString(),
    })
    return true
  }

  registerAccount(accountId: string): void {
    this.activeAccounts.add(accountId)
    if (this.pollTimer === null && this.onPoll) {
      this.startPolling()
    }
  }

  unregisterAccount(accountId: string): void {
    this.activeAccounts.delete(accountId)
    this.lastKnownStates.delete(accountId)
    if (this.activeAccounts.size === 0 && this.pollTimer !== null) {
      this.stopPolling()
    }
  }

  startPolling(): void {
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(async () => {
      for (const accountId of this.activeAccounts) {
        try {
          await this.onPoll?.(accountId)
        } catch (err: unknown) {
          this.emit({
            type: 'error',
            accountId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          })
        }
      }
    }, this.pollIntervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

export type SignalListener = (...args: unknown[]) => void

/**
 * Process-signal port.
 *
 * Injected so the shutdown path can be exercised deterministically in tests
 * without delivering a real operating-system signal.
 */
export interface SignalSource {
  on(event: string, listener: SignalListener): void
}

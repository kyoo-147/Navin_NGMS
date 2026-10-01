import { AsyncLocalStorage } from 'node:async_hooks'

export interface CorrelationContext {
  /** Request-scoped correlation identifier propagated in headers and logs. */
  correlationId: string
  /** Optional surface attribution (`mail`, `control`, `cli`). */
  surface?: string
}

const storage = new AsyncLocalStorage<CorrelationContext>()

/**
 * Bind `context` to the current async execution.
 *
 * Used by the request hook so that every log line and downstream call within
 * the request lifecycle inherits the correlation id without threading it
 * through function signatures.
 */
export function enterCorrelation(context: CorrelationContext): void {
  storage.enterWith(context)
}

/** Run `fn` with `context` bound, restoring the previous context afterwards. */
export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn)
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore()
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId
}

import { ApiCancelledError, isAbortError } from './errors.js'

export interface LinkedSignal {
  readonly signal: AbortSignal
  /** True when the internal timeout fired rather than the caller aborting. */
  timedOut(): boolean
  /** Stops the connect/response timeout while keeping caller cancellation wired up. */
  clearTimeout(): void
  /** Removes every listener and timer created for this attempt. */
  dispose(): void
}

/**
 * Combines a caller-provided AbortSignal with an optional timeout into a single child signal
 * whose abort reason distinguishes cancellation from timeout.
 */
export function linkSignals(
  external: AbortSignal | undefined,
  timeoutMs: number | undefined,
): LinkedSignal {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const onAbort = (): void => {
    controller.abort(external?.reason)
  }

  if (external) {
    if (external.aborted) {
      controller.abort(external.reason)
    } else {
      external.addEventListener('abort', onAbort)
    }
  }

  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('timeout'))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clearTimeout: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
    dispose: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      external?.removeEventListener('abort', onAbort)
    },
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApiCancelledError('Operation was cancelled', { cause: signal.reason })
  }
}

export { isAbortError }

import { ProtocolError, type ProtocolName } from './errors.js'

/** Per-operation cancellation and timeout controls accepted by every client method. */
export interface OperationOptions {
  /** Caller-supplied cancellation signal; aborting it aborts the operation. */
  signal?: AbortSignal
  /** Overrides the connection default command timeout for this operation. */
  timeoutMs?: number
}

/** Raised (as an abort reason) when an operation exceeds its wall-clock budget. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export interface Deadline {
  signal: AbortSignal
  timedOut(): boolean
  dispose(): void
}

/**
 * Creates a derived abort signal that fires when the parent aborts or when the
 * timeout elapses, whichever comes first. The timer is unreffed so it never
 * keeps the process alive.
 */
export function createDeadline(parent?: AbortSignal, timeoutMs?: number): Deadline {
  const controller = new AbortController()
  let timedOut = false

  const forwardAbort = (): void => {
    controller.abort(parent?.reason)
  }

  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason)
    } else {
      parent.addEventListener('abort', forwardAbort, { once: true })
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  if (typeof timeoutMs === 'number' && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new TimeoutError(`Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      if (parent) parent.removeEventListener('abort', forwardAbort)
    },
  }
}

/** Translates an aborted signal's reason into a normalized `ProtocolError`. */
export function abortReasonToError(
  signal: AbortSignal,
  protocol: ProtocolName,
  details: Record<string, unknown> = {},
): ProtocolError {
  const reason: unknown = signal.reason
  if (reason instanceof ProtocolError) return reason
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return new ProtocolError('TIMEOUT', reason.message, { protocol, details })
  }
  const message = reason instanceof Error ? reason.message : 'Operation aborted'
  return new ProtocolError('ABORTED', message, { protocol, details })
}

export interface TimeoutSignal {
  signal: AbortSignal
  timedOut: () => boolean
  clear: () => void
}

export function createTimeoutSignal(timeoutMs: number): TimeoutSignal {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Math.max(0, timeoutMs),
  )
  if (typeof timer.unref === 'function') timer.unref()
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer),
  }
}

export interface CombinedSignal {
  signal: AbortSignal
  clear: () => void
}

export function combineAbortSignals(signals: Array<AbortSignal | undefined>): CombinedSignal {
  const controller = new AbortController()
  const listeners: Array<() => void> = []

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort()
      break
    }
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    listeners.push(() => signal.removeEventListener('abort', onAbort))
  }

  return {
    signal: controller.signal,
    clear: () => {
      for (const remove of listeners) remove()
      listeners.length = 0
    },
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        cleanup()
        resolve()
      },
      Math.max(0, ms),
    )
    if (typeof timer.unref === 'function') timer.unref()
    const onAbort = () => {
      cleanup()
      const error = new Error('AbortError')
      error.name = 'AbortError'
      reject(error)
    }
    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

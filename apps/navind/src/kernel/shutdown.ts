import type { Logger } from '../ports/logger.js'
import type { SignalSource } from '../ports/signal-source.js'

export interface ShutdownCoordinatorOptions {
  logger: Logger
  /** Per-task ceiling. A hung task never blocks the whole shutdown. */
  timeoutMs: number
}

/**
 * Coordinates a single, ordered, idempotent shutdown.
 *
 * Tasks run in reverse registration order (last-in, first-out) so that
 * dependents stop before their dependencies. The first `shutdown()` call wins;
 * concurrent and repeated calls await the same promise.
 */
export class ShutdownCoordinator {
  private readonly tasks: { name: string; run: () => Promise<void> | void }[] = []
  private readonly logger: Logger
  private readonly timeoutMs: number
  private shutdownPromise?: Promise<void>

  constructor(options: ShutdownCoordinatorOptions) {
    this.logger = options.logger
    this.timeoutMs = options.timeoutMs
  }

  register(name: string, run: () => Promise<void> | void): void {
    this.tasks.push({ name, run })
  }

  get isShuttingDown(): boolean {
    return this.shutdownPromise !== undefined
  }

  shutdown(reason: string): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.perform(reason)
    }
    return this.shutdownPromise
  }

  private async perform(reason: string): Promise<void> {
    this.logger.info('shutdown initiated', { reason })
    for (const task of [...this.tasks].reverse()) {
      try {
        await withTimeout(
          Promise.resolve(task.run()),
          this.timeoutMs,
          `shutdown task "${task.name}"`,
        )
        this.logger.debug('shutdown task complete', { task: task.name })
      } catch (error) {
        this.logger.error('shutdown task failed', { task: task.name, err: error })
      }
    }
    this.logger.info('shutdown complete', { reason })
  }
}

export interface InstallSignalHandlersOptions {
  /** Signal source. Defaults to `process`; injectable for tests. */
  source?: SignalSource
  /** Signals to listen for. Defaults to `SIGINT` and `SIGTERM`. */
  signals?: readonly string[]
  /** Invoked once shutdown triggered by a signal has completed. */
  onShutdown?: (reason: string) => void
}

export function installSignalHandlers(
  coordinator: ShutdownCoordinator,
  logger: Logger,
  options: InstallSignalHandlersOptions = {},
): void {
  const source = options.source ?? process
  const signals = options.signals ?? ['SIGINT', 'SIGTERM']
  const { onShutdown } = options

  for (const signal of signals) {
    source.on(signal, () => {
      const completion = coordinator.shutdown(signal)
      if (onShutdown) {
        void completion.finally(() => onShutdown(signal))
      }
    })
  }
  logger.debug('signal handlers installed', { signals: [...signals] })
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    timer.unref()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

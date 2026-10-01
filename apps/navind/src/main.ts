import { pathToFileURL } from 'node:url'
import { loadConfig } from './config/config.js'
import { createContainer } from './kernel/container.js'
import { NavinKernel } from './kernel/kernel.js'
import { ShutdownCoordinator, installSignalHandlers } from './kernel/shutdown.js'

/** Message accepted on the IPC channel to request a graceful shutdown. */
export const SHUTDOWN_MESSAGE = 'navind:shutdown'

function isShutdownMessage(message: unknown): boolean {
  if (typeof message === 'string') {
    return message === SHUTDOWN_MESSAGE
  }
  if (typeof message === 'object' && message !== null) {
    return (message as { type?: unknown }).type === 'shutdown'
  }
  return false
}

export async function run(): Promise<void> {
  const config = loadConfig()
  const container = createContainer(config)
  const logger = container.logger

  const kernel = new NavinKernel(container)
  const coordinator = new ShutdownCoordinator({
    logger,
    timeoutMs: config.shutdownTimeoutMs,
  })
  coordinator.register('kernel', () => kernel.stop())

  // Release the event loop once shutdown finishes. An open IPC channel keeps a
  // Node process alive on its own, so the supervisor channel must be closed.
  const releaseEventLoop = (): void => {
    if (process.connected) {
      process.disconnect()
    }
  }

  const terminate = (reason: string, exitCode: number): void => {
    void coordinator.shutdown(reason).finally(() => {
      if (exitCode !== 0) {
        process.exitCode = exitCode
      }
      releaseEventLoop()
    })
  }

  installSignalHandlers(coordinator, logger, { onShutdown: releaseEventLoop })

  process.on('uncaughtException', (error) => {
    logger.fatal('uncaught exception', { err: error })
    terminate('uncaughtException', 1)
  })

  process.on('unhandledRejection', (reason) => {
    logger.fatal('unhandled rejection', { err: reason })
    terminate('unhandledRejection', 1)
  })

  // When supervised over an IPC channel, allow the parent to request a
  // graceful shutdown. This is the cross-platform equivalent of SIGTERM.
  if (typeof process.send === 'function') {
    process.on('message', (message) => {
      if (isShutdownMessage(message)) {
        terminate('ipc', 0)
      }
    })
  }

  try {
    await kernel.start()
  } catch (error) {
    logger.fatal('navind failed to start', { err: error })
    await coordinator.shutdown('startup-failure')
    process.exitCode = 1
  }
}

const entrypoint = process.argv[1]
const isDirectRun = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href

if (isDirectRun) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'fatal', msg: 'navind run failed', err: String(error) })}\n`,
    )
    process.exitCode = 1
  })
}

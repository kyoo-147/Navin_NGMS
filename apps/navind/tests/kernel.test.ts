import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonLogger } from '../src/adapters/json-logger.js'
import { loadConfig } from '../src/config/config.js'
import { createContainer } from '../src/kernel/container.js'
import { NavinKernel } from '../src/kernel/kernel.js'
import { ShutdownCoordinator, installSignalHandlers } from '../src/kernel/shutdown.js'
import type { SignalSource } from '../src/ports/signal-source.js'
import { CaptureSink, FixedClock, createTempDir, removeTempDir } from './support/test-helpers.js'

function createLogger(sink: CaptureSink, clock: FixedClock): JsonLogger {
  return new JsonLogger({ level: 'debug', clock, sink })
}

describe('NavinKernel lifecycle', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir()
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('starts, serves health and readiness, and stops cleanly and idempotently', async () => {
    const sink = new CaptureSink()
    const databasePath = join(dir, 'navin.db')
    const config = loadConfig({
      env: {
        NAVIN_DATABASE_PATH: databasePath,
        NAVIN_PORT: '0',
        NAVIN_LOG_LEVEL: 'debug',
      },
    })
    const container = createContainer(config, { sink })
    const kernel = new NavinKernel(container)

    const started = await kernel.start()
    expect(started.port).toBeGreaterThan(0)
    expect(kernel.isStarted).toBe(true)

    const health = await fetch(`http://127.0.0.1:${started.port}/health`)
    expect(health.status).toBe(200)

    const ready = await fetch(`http://127.0.0.1:${started.port}/ready`)
    expect(ready.status).toBe(200)
    const readyBody = (await ready.json()) as { checks: { name: string }[] }
    expect(readyBody.checks.map((check) => check.name).sort()).toEqual(['database', 'migrations'])

    await kernel.stop()
    expect(kernel.isStarted).toBe(false)
    await expect(fetch(`http://127.0.0.1:${started.port}/health`)).rejects.toThrow()

    // Second stop is a no-op and must not throw.
    await kernel.stop()

    expect(existsSync(databasePath)).toBe(true)
    const messages = sink.records().map((record) => record.msg)
    expect(messages).toContain('navind listening')
    expect(messages).toContain('navind stopped')
  })

  it('closes the database when startup fails after opening it', async () => {
    const sink = new CaptureSink()
    const config = loadConfig({
      env: {
        NAVIN_DATABASE_PATH: join(dir, 'navin.db'),
        NAVIN_PORT: '0',
      },
    })
    const container = createContainer(config, { sink })
    container.databaseFactory.open = () => {
      throw new Error('cannot open database')
    }
    const kernel = new NavinKernel(container)

    await expect(kernel.start()).rejects.toThrow('cannot open database')
    expect(kernel.isStarted).toBe(false)
  })
})

describe('ShutdownCoordinator', () => {
  it('runs tasks in reverse order exactly once', async () => {
    const sink = new CaptureSink()
    const clock = new FixedClock()
    const logger = createLogger(sink, clock)
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({ logger, timeoutMs: 1000 })

    coordinator.register('first', () => {
      order.push('first')
    })
    coordinator.register('second', async () => {
      order.push('second')
    })

    const first = coordinator.shutdown('SIGTERM')
    const second = coordinator.shutdown('SIGTERM again')
    expect(first).toBe(second)

    await first
    expect(order).toEqual(['second', 'first'])
    expect(coordinator.isShuttingDown).toBe(true)
    expect(sink.records().map((record) => record.msg)).toContain('shutdown complete')
  })

  it('does not hang when a task exceeds the timeout', async () => {
    const sink = new CaptureSink()
    const logger = createLogger(sink, new FixedClock())
    const coordinator = new ShutdownCoordinator({ logger, timeoutMs: 50 })
    coordinator.register('hang', () => new Promise<void>(() => {}))

    await coordinator.shutdown('timeout')
    const failure = sink.records().find((record) => record.msg === 'shutdown task failed')
    expect(failure).toBeDefined()
  })

  it('triggers shutdown from a process signal source', async () => {
    const sink = new CaptureSink()
    const logger = createLogger(sink, new FixedClock())
    const coordinator = new ShutdownCoordinator({ logger, timeoutMs: 1000 })
    const calls: string[] = []
    coordinator.register('task', () => {
      calls.push('task')
    })

    const emitter = new EventEmitter()
    installSignalHandlers(coordinator, logger, { source: emitter as unknown as SignalSource })
    emitter.emit('SIGTERM')

    await coordinator.shutdown('SIGTERM')
    expect(calls).toEqual(['task'])
    expect(coordinator.isShuttingDown).toBe(true)
  })
})

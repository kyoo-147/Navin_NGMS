import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getFreePort, parseLogRecord, startNavind } from './support/spawn-server.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

describe('navind real process', () => {
  it('boots, serves health and readiness with correlation, and shuts down gracefully', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')
    const port = await getFreePort()
    const proc = await startNavind({
      port,
      env: { NAVIN_DATABASE_PATH: databasePath, NAVIN_LOG_LEVEL: 'debug' },
    })

    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { 'x-correlation-id': 'proc-corr-1' },
      })
      expect(health.status).toBe(200)
      expect(health.headers.get('x-correlation-id')).toBe('proc-corr-1')
      const healthBody = (await health.json()) as { correlationId: string; status: string }
      expect(healthBody.correlationId).toBe('proc-corr-1')
      expect(healthBody.status).toBe('ok')

      const ready = await fetch(`http://127.0.0.1:${port}/ready`)
      expect(ready.status).toBe(200)
      expect(((await ready.json()) as { status: string }).status).toBe('ready')

      const exit = await proc.shutdown()
      expect(exit.code).toBe(0)
      expect(proc.stdout()).toContain('shutdown complete')
      expect(existsSync(databasePath)).toBe(true)
    } finally {
      proc.kill()
      removeTempDir(dir)
    }
  })

  it('persists boot count and applied migrations across a restart', async () => {
    const dir = createTempDir()
    const databasePath = join(dir, 'navin.db')

    try {
      const firstPort = await getFreePort()
      const first = await startNavind({
        port: firstPort,
        env: { NAVIN_DATABASE_PATH: databasePath },
      })
      const firstReady = (await (await fetch(`http://127.0.0.1:${firstPort}/ready`)).json()) as {
        checks: { name: string; details?: { applied?: number } }[]
      }
      const firstBoot = parseLogRecord(first.stdout(), 'navind listening')
      expect((await first.shutdown()).code).toBe(0)

      const secondPort = await getFreePort()
      const second = await startNavind({
        port: secondPort,
        env: { NAVIN_DATABASE_PATH: databasePath },
      })
      const secondBoot = parseLogRecord(second.stdout(), 'navind listening')
      expect((await second.shutdown()).code).toBe(0)

      const migrations = firstReady.checks.find((check) => check.name === 'migrations')
      expect(migrations?.details?.applied).toBe(2)
      expect(Number(secondBoot?.bootCount)).toBe(Number(firstBoot?.bootCount) + 1)
    } finally {
      removeTempDir(dir)
    }
  })
})

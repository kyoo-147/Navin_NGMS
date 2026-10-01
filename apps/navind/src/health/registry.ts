import { performance } from 'node:perf_hooks'
import type { Clock } from '../ports/clock.js'
import type {
  HealthCheck,
  HealthCheckResult,
  HealthRegistry,
  HealthReport,
} from '../ports/health.js'

export class DefaultHealthRegistry implements HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>()

  constructor(private readonly clock: Clock) {}

  register(check: HealthCheck): void {
    this.checks.set(check.name, check)
  }

  async run(): Promise<HealthReport> {
    const checks: HealthCheckResult[] = []
    for (const check of this.checks.values()) {
      checks.push(await this.runCheck(check))
    }

    const state = checks.some((result) => result.critical && result.state === 'unhealthy')
      ? 'unhealthy'
      : 'healthy'

    return { state, checks, timestamp: this.clock.nowIso() }
  }

  private async runCheck(check: HealthCheck): Promise<HealthCheckResult> {
    const start = performance.now()
    try {
      const probe = await check.check()
      return {
        name: check.name,
        critical: check.critical,
        state: probe.state,
        message: probe.message,
        details: probe.details,
        durationMs: Math.round((performance.now() - start) * 1000) / 1000,
      }
    } catch (error) {
      return {
        name: check.name,
        critical: check.critical,
        state: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Math.round((performance.now() - start) * 1000) / 1000,
      }
    }
  }
}

export type HealthState = 'healthy' | 'unhealthy'

export interface HealthProbeResult {
  state: HealthState
  message?: string
  details?: Record<string, unknown>
}

/**
 * A single readiness probe. `critical` checks make the whole instance
 * not-ready when they fail; non-critical checks are surfaced but degrade
 * rather than block traffic.
 */
export interface HealthCheck {
  readonly name: string
  readonly critical: boolean
  check(): Promise<HealthProbeResult> | HealthProbeResult
}

export interface HealthCheckResult {
  name: string
  state: HealthState
  critical: boolean
  durationMs: number
  message?: string
  details?: Record<string, unknown>
}

export interface HealthReport {
  state: HealthState
  checks: HealthCheckResult[]
  timestamp: string
}

export interface HealthRegistry {
  register(check: HealthCheck): void
  run(): Promise<HealthReport>
}

import type { Migrator } from '../db/migrator.js'
import type { Database } from '../ports/database.js'
import type { HealthCheck } from '../ports/health.js'

export function createDatabaseCheck(database: Database): HealthCheck {
  return {
    name: 'database',
    critical: true,
    check() {
      try {
        database.get<{ ok: number }>('SELECT 1 AS ok')
        return {
          state: 'healthy',
          details: { path: database.path, open: database.isOpen },
        }
      } catch (error) {
        return {
          state: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
          details: { path: database.path, open: database.isOpen },
        }
      }
    },
  }
}

export function createMigrationsCheck(migrator: Migrator): HealthCheck {
  return {
    name: 'migrations',
    critical: true,
    check() {
      const status = migrator.status()
      if (status.pending.length > 0) {
        return {
          state: 'unhealthy',
          message: `${status.pending.length} pending migration(s)`,
          details: { pending: status.pending, latest: status.latest },
        }
      }
      return {
        state: 'healthy',
        details: { applied: status.applied.length, latest: status.latest },
      }
    },
  }
}

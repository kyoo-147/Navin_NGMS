import { createHash } from 'node:crypto'

export interface Migration {
  /** Monotonic, unique migration identifier. */
  id: number
  /** Human-readable name recorded alongside the applied row. */
  name: string
  /**
   * Deterministic SQL applied by this migration. Stored as a string literal so
   * the same source and compiled output produce an identical fingerprint.
   */
  sql: string
}

/**
 * Deterministic fingerprint of a migration's identity and body.
 *
 * Hashing the declared SQL (rather than a transpiled function body) keeps the
 * checksum stable between the TypeScript sources used by tests and the
 * compiled JavaScript used in production, so drift is detected across restarts
 * and across builds without false positives.
 */
export function computeMigrationChecksum(
  migration: Pick<Migration, 'id' | 'name' | 'sql'>,
): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.name}\n${migration.sql}`)
    .digest('hex')
}

/**
 * Ordered kernel migrations.
 *
 * These create only kernel-owned, infrastructure tables. Domain schemas are
 * added by their owning packages in later waves; the migrator is generic.
 */
export const KERNEL_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'create_kernel_metadata',
    sql: `
      CREATE TABLE kernel_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    id: 2,
    name: 'index_kernel_metadata_updated_at',
    sql: `
      CREATE INDEX idx_kernel_metadata_updated_at ON kernel_metadata (updated_at)
    `,
  },
]

import type { Clock } from '../ports/clock.js'
import type { Database } from '../ports/database.js'

const METADATA_TABLE = 'kernel_metadata'

export const BOOT_COUNT_KEY = 'kernel.boot_count'
export const LAST_BOOT_AT_KEY = 'kernel.last_boot_at'

interface ValueRow {
  value: string
}

/**
 * Typed access to the kernel's key/value metadata table.
 *
 * This is infrastructure bookkeeping (boot history, feature flags and similar
 * operational state), not domain storage.
 */
export class MetadataStore {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  get(key: string): string | undefined {
    return this.database.get<ValueRow>(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`, [key])
      ?.value
  }

  set(key: string, value: string): void {
    this.database.run(
      `
        INSERT INTO ${METADATA_TABLE} (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      [key, value, this.clock.nowIso()],
    )
  }

  increment(key: string, delta = 1): number {
    const now = this.clock.nowIso()
    return this.database.transaction((database) => {
      const row = database.get<ValueRow>(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`, [key])
      const parsed = row ? Number.parseInt(row.value, 10) : 0
      const current = Number.isFinite(parsed) ? parsed : 0
      const next = current + delta
      database.run(
        `
          INSERT INTO ${METADATA_TABLE} (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `,
        [key, String(next), now],
      )
      return next
    })
  }

  /** Records this process boot and returns the persisted boot count. */
  recordBoot(): { bootCount: number; bootedAt: string } {
    const bootedAt = this.clock.nowIso()
    const bootCount = this.increment(BOOT_COUNT_KEY)
    this.set(LAST_BOOT_AT_KEY, bootedAt)
    return { bootCount, bootedAt }
  }
}

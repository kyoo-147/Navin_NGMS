import { SqliteDatabase } from '../../src/adapters/sqlite-database.js'
import { SystemClock } from '../../src/adapters/system-clock.js'
import { MetadataStore } from '../../src/db/metadata-store.js'
import { KERNEL_MIGRATIONS } from '../../src/db/migrations.js'
import { Migrator } from '../../src/db/migrator.js'

const databasePath = process.env.NAVIND_TEST_DB
const prefix = process.env.NAVIND_TEST_PREFIX ?? 'w'
const count = Number(process.env.NAVIND_TEST_COUNT ?? '50')

if (!databasePath) {
  throw new Error('NAVIND_TEST_DB is required')
}

const database = SqliteDatabase.open({ path: databasePath, timeoutMs: 15000 })
const clock = new SystemClock()
new Migrator(database, KERNEL_MIGRATIONS, clock).migrate()

const store = new MetadataStore(database, clock)
database.transaction(() => {
  for (let index = 0; index < count; index += 1) {
    store.set(`${prefix}:${index}`, String(index))
  }
})

database.close()
process.stdout.write(`${JSON.stringify({ prefix, count })}\n`)

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../src/adapters/sqlite-database.js'
import { createTempDir, removeTempDir } from './support/test-helpers.js'

describe('SqliteDatabase', () => {
  let dir: string
  let databasePath: string

  beforeEach(() => {
    dir = createTempDir()
    databasePath = join(dir, 'navin.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('opens in WAL mode with the configured busy timeout', () => {
    const database = SqliteDatabase.open({ path: databasePath, timeoutMs: 3000 })

    expect(String(database.readPragma('journal_mode')).toLowerCase()).toBe('wal')
    expect(database.readPragma('busy_timeout')).toBe(3000)
    expect(database.isOpen).toBe(true)
    expect(database.path).toBe(databasePath)

    database.close()
    expect(database.isOpen).toBe(false)
  })

  it('persists data across close and reopen', () => {
    const first = SqliteDatabase.open({ path: databasePath })
    first.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    first.run('INSERT INTO items (name) VALUES (?)', ['alpha'])
    first.close()

    const second = SqliteDatabase.open({ path: databasePath })
    const rows = second.all<{ id: number; name: string }>('SELECT id, name FROM items ORDER BY id')
    expect(rows).toEqual([{ id: 1, name: 'alpha' }])
    second.close()
  })

  it('rolls back a failed transaction and keeps prior committed data', () => {
    const database = SqliteDatabase.open({ path: databasePath })
    database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    database.run('INSERT INTO items (name) VALUES (?)', ['committed'])

    expect(() =>
      database.transaction((tx) => {
        tx.run('INSERT INTO items (name) VALUES (?)', ['rolled-back'])
        throw new Error('boom')
      }),
    ).toThrow('boom')

    const rows = database.all<{ name: string }>('SELECT name FROM items')
    expect(rows.map((row) => row.name)).toEqual(['committed'])
    database.close()
  })

  it('joins nested transactions into a single commit', () => {
    const database = SqliteDatabase.open({ path: databasePath })
    database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')

    database.transaction((outer) => {
      outer.run('INSERT INTO items (name) VALUES (?)', ['outer'])
      outer.transaction((inner) => {
        inner.run('INSERT INTO items (name) VALUES (?)', ['inner'])
      })
    })

    expect(database.all<{ name: string }>('SELECT name FROM items')).toHaveLength(2)
    database.close()
  })

  it('refuses to run statements after close', () => {
    const database = SqliteDatabase.open({ path: databasePath })
    database.close()
    expect(() => database.exec('SELECT 1')).toThrow(/closed/)
  })
})

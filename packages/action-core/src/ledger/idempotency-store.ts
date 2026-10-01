import { ActionCoreError } from '../errors.js'
import { sha256Digest } from '../json.js'
import type { SqliteDatabase } from '../sqlite/database.js'

export interface IdempotencyRecord {
  scope: string
  key: string
  requestHash: string
  resourceType: string
  resourceId: string
  createdAt: string
}

export interface ReserveIdempotencyInput {
  scope: string
  key: string
  requestHash: string
  resourceType: string
  resourceId: string
  now: string
}

export interface IdempotencyReservation {
  /** True when a matching request was already recorded and the resource reused. */
  idempotent: boolean
  record: IdempotencyRecord
}

interface IdempotencyRow {
  scope: string
  key: string
  request_hash: string
  resource_type: string
  resource_id: string
  created_at: string
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    createdAt: row.created_at,
  }
}

/**
 * Records idempotency keys so retried submissions reuse the original resource
 * instead of duplicating a mutation. `reserve` must be called inside the same
 * transaction that creates the resource so reservation and write are atomic.
 */
export class IdempotencyStore {
  constructor(private readonly db: SqliteDatabase) {}

  hashRequest(value: unknown): string {
    return sha256Digest(value)
  }

  find(scope: string, key: string): IdempotencyRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM idempotency WHERE scope = ? AND key = ?')
      .get(scope, key) as IdempotencyRow | undefined
    return row === undefined ? undefined : toRecord(row)
  }

  reserve(input: ReserveIdempotencyInput): IdempotencyReservation {
    const existing = this.find(input.scope, input.key)
    if (existing !== undefined) {
      if (existing.requestHash !== input.requestHash) {
        throw new ActionCoreError(
          'IDEMPOTENCY_CONFLICT',
          `Idempotency key ${input.key} was already used with a different request body`,
          { details: { scope: input.scope, key: input.key } },
        )
      }
      return { idempotent: true, record: existing }
    }

    this.db
      .prepare(
        `INSERT INTO idempotency (scope, key, request_hash, resource_type, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.scope,
        input.key,
        input.requestHash,
        input.resourceType,
        input.resourceId,
        input.now,
      )

    return {
      idempotent: false,
      record: {
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        createdAt: input.now,
      },
    }
  }
}

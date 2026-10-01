import {
  EvidenceRecordSchema,
  type EvidenceCheckType,
  type EvidenceRecord,
  type EvidenceStatus,
} from '@navin/contracts'

import { nowIso, type Clock } from '../clock.js'
import { ActionCoreError } from '../errors.js'
import { canonicalJson, parseJson, sha256Bytes, stringifyJson } from '../json.js'
import { redact, redactRecord } from '../redaction.js'
import type { SqliteDatabase } from '../sqlite/database.js'
import type { IdFactory } from '../ids.js'
import { assertContract } from '../validation.js'

export interface AppendEvidenceInput {
  id?: string
  checkType: EvidenceCheckType
  status: EvidenceStatus
  target: string
  collector: string
  observedAt?: string
  details?: Record<string, unknown>
  digest?: string
  rawOutputRedacted?: string
}

export interface ListEvidenceFilter {
  checkType?: EvidenceCheckType
  status?: EvidenceStatus
  target?: string
  limit?: number
  offset?: number
}

export interface EvidenceLedgerDeps {
  ids: IdFactory
  clock: Clock
}

interface EvidenceRow {
  id: string
  check_type: string
  status: string
  target: string
  collector: string
  observed_at: string
  details: string
  digest: string | null
  raw_output_redacted: string | null
}

function toRecord(row: EvidenceRow): EvidenceRecord {
  const details = parseJson<Record<string, unknown>>(row.details) ?? {}
  return {
    id: row.id,
    checkType: row.check_type as EvidenceCheckType,
    status: row.status as EvidenceStatus,
    target: row.target,
    collector: row.collector,
    observedAt: row.observed_at,
    details,
    ...(row.digest === null ? {} : { digest: row.digest }),
    ...(row.raw_output_redacted === null ? {} : { rawOutputRedacted: row.raw_output_redacted }),
  }
}

function digestOf(record: {
  checkType: EvidenceCheckType
  status: EvidenceStatus
  target: string
  collector: string
  observedAt: string
  details: Record<string, unknown>
  rawOutputRedacted?: string
}): string {
  const bytes = Buffer.from(
    canonicalJson({
      checkType: record.checkType,
      status: record.status,
      target: record.target,
      collector: record.collector,
      observedAt: record.observedAt,
      details: record.details,
      rawOutputRedacted: record.rawOutputRedacted ?? null,
    }),
    'utf8',
  )
  return sha256Bytes(bytes)
}

/**
 * A `passed` evidence record must carry the verifier's observed output. Metadata
 * such as `{ receipt: "sha256:..." }` is not an observation and can never admit
 * a PASS by itself.
 */
function assertPassAdmission(record: EvidenceRecord): void {
  if (record.status !== 'passed') {
    return
  }
  if (record.rawOutputRedacted === undefined || record.rawOutputRedacted.trim().length === 0) {
    throw new ActionCoreError(
      'VALIDATION_FAILED',
      'A passed evidence record requires non-empty output from an explicit production verifier',
      { details: { id: record.id, status: record.status } },
    )
  }
}

/**
 * Append-only evidence ledger. Writes are redacted before persistence and the
 * sha256 digest is computed over the redacted content so tampering is detectable.
 * Records can never be updated or deleted (database triggers enforce this).
 */
export class EvidenceLedger {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly deps: EvidenceLedgerDeps,
  ) {}

  append(input: AppendEvidenceInput): EvidenceRecord {
    const id = input.id ?? this.deps.ids('evi')
    const observedAt = input.observedAt ?? nowIso(this.deps.clock)
    const details = redactRecord(input.details) ?? {}
    const rawOutputRedacted =
      input.rawOutputRedacted === undefined ? undefined : redact(input.rawOutputRedacted)

    const digest = digestOf({
      checkType: input.checkType,
      status: input.status,
      target: input.target,
      collector: input.collector,
      observedAt,
      details,
      ...(rawOutputRedacted === undefined ? {} : { rawOutputRedacted }),
    })

    if (input.digest !== undefined && input.digest !== digest) {
      throw new ActionCoreError('VALIDATION_FAILED', 'Evidence digest does not match content', {
        details: { provided: input.digest, computed: digest },
      })
    }

    const record: EvidenceRecord = {
      id,
      checkType: input.checkType,
      status: input.status,
      target: input.target,
      collector: input.collector,
      observedAt,
      details,
      digest,
      ...(rawOutputRedacted === undefined ? {} : { rawOutputRedacted }),
    }
    assertContract(EvidenceRecordSchema, record, 'evidence record')
    assertPassAdmission(record)

    this.db
      .prepare(
        `INSERT INTO evidence
           (id, check_type, status, target, collector, observed_at, details, digest, raw_output_redacted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.checkType,
        record.status,
        record.target,
        record.collector,
        record.observedAt,
        stringifyJson(record.details),
        record.digest ?? null,
        record.rawOutputRedacted ?? null,
      )

    return record
  }

  get(id: string): EvidenceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as
      EvidenceRow | undefined
    return row === undefined ? undefined : toRecord(row)
  }

  require(id: string): EvidenceRecord {
    const record = this.get(id)
    if (record === undefined) {
      throw new ActionCoreError('NOT_FOUND', `Evidence ${id} was not found`, { details: { id } })
    }
    return record
  }

  list(filter: ListEvidenceFilter = {}): EvidenceRecord[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filter.checkType !== undefined) {
      clauses.push('check_type = ?')
      params.push(filter.checkType)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.target !== undefined) {
      clauses.push('target = ?')
      params.push(filter.target)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const limit = Math.max(1, Math.trunc(filter.limit ?? 200))
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
    const rows = this.db
      .prepare(`SELECT * FROM evidence${where} ORDER BY observed_at ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as EvidenceRow[]
    return rows.map(toRecord)
  }

  /** Recomputes the digest and reports whether the stored record is intact. */
  verifyDigest(id: string): boolean {
    const record = this.require(id)
    return record.digest === digestOf(record)
  }
}

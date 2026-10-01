import { createHash } from 'node:crypto'
import type { SetupBlock, SetupEvent, SetupSession } from '@navin/contracts'
import type {
  SetupBlockRecord,
  SetupDatabase,
  SetupEvidence,
  SetupSessionRecord,
  StoredSetupEvent,
} from './types.js'

interface SessionRow {
  id: string
  title: string
  current_stage: string
  status: string
  intelligence_mode: string
  target_host_json: string | null
  event_cursor: string | null
  created_at: string
  updated_at: string
  revision: number
  checksum: string
}

interface BlockRow {
  id: string
  session_id: string
  schema_version: string
  stage: string
  kind: string
  status: string
  title: string
  summary: string
  input_schema_json: string | null
  value_json: string | null
  evidence_ids_json: string | null
  risk: string | null
  can_retry: number
  can_rollback: number
  dependencies_json: string
  created_at: string
  updated_at: string
  revision: number
  checksum: string
}

interface EvidenceRow {
  id: string
  session_id: string
  block_id: string
  status: 'passed' | 'warning' | 'failed'
  kind: string
  details_json: string
  observed_at: string
  checksum: string
}

interface EventRow {
  seq: number
  id: string
  session_id: string
  payload_json: string
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

export function checksum(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function deterministicId(prefix: 'set' | 'blk' | 'evi' | 'evt', value: unknown): string {
  return `${prefix}_${checksum(value).slice(0, 32)}`
}

export class SetupStore {
  constructor(private readonly db: SetupDatabase) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS setup_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        status TEXT NOT NULL,
        intelligence_mode TEXT NOT NULL,
        target_host_json TEXT,
        event_cursor TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS setup_blocks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES setup_sessions(id) ON DELETE CASCADE,
        schema_version TEXT NOT NULL,
        stage TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        input_schema_json TEXT,
        value_json TEXT,
        evidence_ids_json TEXT,
        risk TEXT,
        can_retry INTEGER NOT NULL,
        can_rollback INTEGER NOT NULL,
        dependencies_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        UNIQUE(session_id, stage, kind)
      );
      CREATE INDEX IF NOT EXISTS setup_blocks_session_idx ON setup_blocks(session_id, stage);
      CREATE TABLE IF NOT EXISTS setup_evidence (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES setup_sessions(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL REFERENCES setup_blocks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        details_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS setup_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL REFERENCES setup_sessions(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS setup_events_session_idx ON setup_events(session_id, seq);
      CREATE TABLE IF NOT EXISTS setup_loopback_mutations (
        session_id TEXT NOT NULL REFERENCES setup_sessions(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL REFERENCES setup_blocks(id) ON DELETE CASCADE,
        mutation_key TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY(session_id, block_id, mutation_key)
      );
    `)
  }

  createSession(session: SetupSessionRecord, blocks: SetupBlockRecord[]): void {
    this.db.transaction((db) => {
      db.run(
        `INSERT INTO setup_sessions
          (id,title,current_stage,status,intelligence_mode,target_host_json,event_cursor,created_at,updated_at,revision,checksum)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          session.id,
          session.title,
          session.currentStage,
          session.status,
          session.intelligenceMode,
          session.targetHost ? stableJson(session.targetHost) : null,
          session.eventCursor ?? null,
          session.createdAt,
          session.updatedAt,
          session.revision,
          session.checksum,
        ],
      )
      for (const block of blocks) this.insertBlock(db, block)
    })
  }

  getSession(id: string): SetupSessionRecord | undefined {
    const row = this.db.get<SessionRow>('SELECT * FROM setup_sessions WHERE id = ?', [id])
    if (!row) return undefined
    return this.mapSession(row)
  }

  listSessions(): SetupSessionRecord[] {
    return this.db
      .all<SessionRow>('SELECT * FROM setup_sessions ORDER BY created_at DESC, id')
      .map((row) => this.mapSession(row))
  }

  updateSession(session: SetupSessionRecord): void {
    this.db.run(
      `UPDATE setup_sessions SET current_stage=?,status=?,event_cursor=?,updated_at=?,revision=?,checksum=? WHERE id=?`,
      [
        session.currentStage,
        session.status,
        session.eventCursor ?? null,
        session.updatedAt,
        session.revision,
        session.checksum,
        session.id,
      ],
    )
  }

  updateBlock(block: SetupBlockRecord): void {
    this.db.run(
      `UPDATE setup_blocks SET status=?,value_json=?,evidence_ids_json=?,updated_at=?,revision=?,checksum=? WHERE id=?`,
      [
        block.status,
        block.value === undefined ? null : stableJson(block.value),
        block.evidenceIds ? stableJson(block.evidenceIds) : null,
        block.updatedAt,
        block.revision,
        block.checksum,
        block.id,
      ],
    )
  }

  addEvidence(evidence: SetupEvidence, sessionId: string, blockId: string): void {
    this.db.run(
      `INSERT OR REPLACE INTO setup_evidence (id,session_id,block_id,status,kind,details_json,observed_at,checksum)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        evidence.id,
        sessionId,
        blockId,
        evidence.status,
        evidence.kind,
        stableJson(evidence.details),
        evidence.observedAt,
        evidence.checksum,
      ],
    )
  }

  addEvent(sessionId: string, event: SetupEvent): StoredSetupEvent {
    const result = this.db.run(
      'INSERT INTO setup_events (id,session_id,payload_json) VALUES (?,?,?)',
      [event.id, sessionId, stableJson(event)],
    )
    return { seq: Number(result.lastInsertRowid), event }
  }

  eventsSince(sessionId: string, cursor = 0): StoredSetupEvent[] {
    return this.db
      .all<EventRow>(
        'SELECT seq,id,session_id,payload_json FROM setup_events WHERE session_id=? AND seq>? ORDER BY seq',
        [sessionId, cursor],
      )
      .map((row) => ({ seq: row.seq, event: JSON.parse(row.payload_json) as SetupEvent }))
  }

  insertLoopbackMutation(
    sessionId: string,
    blockId: string,
    mutationKey: string,
    now: string,
    result: Record<string, unknown>,
  ): boolean {
    const inserted = this.db.run(
      `INSERT OR IGNORE INTO setup_loopback_mutations
       (session_id,block_id,mutation_key,applied_at,result_json) VALUES (?,?,?,?,?)`,
      [sessionId, blockId, mutationKey, now, stableJson(result)],
    )
    return inserted.changes > 0
  }

  hasLoopbackMutation(sessionId: string, blockId: string, mutationKey: string): boolean {
    return (
      this.db.get<{ mutation_key: string }>(
        'SELECT mutation_key FROM setup_loopback_mutations WHERE session_id=? AND block_id=? AND mutation_key=?',
        [sessionId, blockId, mutationKey],
      ) !== undefined
    )
  }

  private insertBlock(db: SetupDatabase, block: SetupBlockRecord): void {
    db.run(
      `INSERT INTO setup_blocks
        (id,session_id,schema_version,stage,kind,status,title,summary,input_schema_json,value_json,evidence_ids_json,risk,can_retry,can_rollback,dependencies_json,created_at,updated_at,revision,checksum)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        block.id,
        block.sessionId,
        block.schemaVersion,
        block.stage,
        block.kind,
        block.status,
        block.title,
        block.summary,
        block.inputSchema ? stableJson(block.inputSchema) : null,
        block.value === undefined ? null : stableJson(block.value),
        block.evidenceIds ? stableJson(block.evidenceIds) : null,
        block.risk ?? null,
        block.canRetry ? 1 : 0,
        block.canRollback ? 1 : 0,
        stableJson(block.dependencies),
        block.createdAt,
        block.updatedAt,
        block.revision,
        block.checksum,
      ],
    )
  }

  private mapSession(row: SessionRow): SetupSessionRecord {
    const blocks = this.db
      .all<BlockRow>('SELECT * FROM setup_blocks WHERE session_id=? ORDER BY rowid', [row.id])
      .map((block) => this.mapBlock(block))
    return {
      id: row.id as SetupSession['id'],
      title: row.title,
      currentStage: row.current_stage as SetupSession['currentStage'],
      status: row.status as SetupSession['status'],
      intelligenceMode: row.intelligence_mode as SetupSession['intelligenceMode'],
      ...(row.target_host_json
        ? { targetHost: JSON.parse(row.target_host_json) as SetupSession['targetHost'] }
        : {}),
      blocks,
      ...(row.event_cursor ? { eventCursor: row.event_cursor } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      checksum: row.checksum,
    }
  }

  private mapBlock(row: BlockRow): SetupBlockRecord {
    const evidence = this.db
      .all<EvidenceRow>('SELECT * FROM setup_evidence WHERE block_id=? ORDER BY observed_at,id', [
        row.id,
      ])
      .map((item) => ({
        id: item.id,
        status: item.status,
        kind: item.kind,
        details: JSON.parse(item.details_json) as Record<string, unknown>,
        observedAt: item.observed_at,
        checksum: item.checksum,
      }))
    const value = row.value_json ? (JSON.parse(row.value_json) as unknown) : undefined
    return {
      id: row.id as SetupBlock['id'],
      sessionId: row.session_id as SetupBlock['sessionId'],
      schemaVersion: row.schema_version,
      stage: row.stage as SetupBlock['stage'],
      kind: row.kind as SetupBlock['kind'],
      status: row.status as SetupBlock['status'],
      title: row.title,
      summary: row.summary,
      ...(row.input_schema_json
        ? { inputSchema: JSON.parse(row.input_schema_json) as Record<string, unknown> }
        : {}),
      ...(value === undefined ? {} : { value }),
      ...(row.evidence_ids_json
        ? { evidenceIds: JSON.parse(row.evidence_ids_json) as SetupBlock['evidenceIds'] }
        : {}),
      ...(row.risk ? { risk: row.risk as SetupBlock['risk'] } : {}),
      canRetry: row.can_retry === 1,
      canRollback: row.can_rollback === 1,
      dependencies: JSON.parse(row.dependencies_json) as SetupBlock['dependencies'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      checksum: row.checksum,
      metadata: { revision: row.revision, checksum: row.checksum, evidence },
    }
  }
}

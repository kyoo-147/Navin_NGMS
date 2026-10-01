import type {
  SetupBlock,
  SetupBlockKind,
  SetupBlockStatus,
  SetupEvent,
  SetupSession,
  SetupStage,
} from '@navin/contracts'

export type SqlValue = null | number | bigint | string | Uint8Array

export interface SetupDatabase {
  exec(sql: string): void
  run(
    sql: string,
    params?: readonly SqlValue[],
  ): { changes: number; lastInsertRowid: number | bigint }
  get<T>(sql: string, params?: readonly SqlValue[]): T | undefined
  all<T>(sql: string, params?: readonly SqlValue[]): T[]
  transaction<T>(fn: (database: SetupDatabase) => T): T
}

export interface SetupClock {
  nowIso(): string
}

export interface SetupBlockMetadata {
  revision: number
  checksum: string
  output?: unknown
  evidence: SetupEvidence[]
}

export interface SetupEvidence {
  id: string
  status: 'passed' | 'warning' | 'failed'
  kind: string
  details: Record<string, unknown>
  observedAt: string
  checksum: string
}

export interface SetupBlockRecord extends SetupBlock {
  revision: number
  checksum: string
  metadata: SetupBlockMetadata
}

export interface SetupSessionRecord extends SetupSession {
  revision: number
  checksum: string
  blocks: SetupBlockRecord[]
}

export type SetupCommand = 'discover' | 'plan' | 'diff' | 'approve' | 'apply' | 'verify'

export type SetupCommandErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BLOCKED'
  | 'VALIDATION_FAILED'
  | 'TYPED_CONFIRMATION_REQUIRED'
  | 'STEP_UP_REQUIRED'

export interface SessionAssurance {
  assuranceLevel: string
  lastAuthenticatedAt: string
}

export interface SetupRunOptions {
  confirmation?: string
  force?: boolean
  sessionAssurance?: SessionAssurance
}

export interface CreateSetupInput {
  title: string
  intelligenceMode?: SetupSession['intelligenceMode']
  targetHost?: SetupSession['targetHost']
  initialStage?: SetupStage
  destructive?: boolean
  blocks?: readonly BlockDefinition[]
}

export interface StoredSetupEvent {
  seq: number
  event: SetupEvent
}

export interface SetupEventListener {
  (event: SetupEvent, stored?: StoredSetupEvent): void
}

export interface SetupExecutor {
  discover(input: {
    sessionId: string
    targetHost?: SetupSession['targetHost']
  }): Record<string, unknown>
  plan(input: { sessionId: string; discovery: unknown }): Record<string, unknown>
  diff(input: { sessionId: string; plan: unknown }): Record<string, unknown>
  apply(input: {
    sessionId: string
    diff: unknown
    database: SetupDatabase
    now: string
  }): Record<string, unknown>
  verify(input: {
    sessionId: string
    applied: unknown
    database: SetupDatabase
  }): Record<string, unknown>
}

export const SETUP_SCHEMA_VERSION = 'setup.v1'

export interface BlockDefinition {
  key: string
  stage: SetupStage
  kind: SetupBlockKind
  status: SetupBlockStatus
  title: string
  summary: string
  risk: 'read' | 'staged' | 'mutable' | 'shared' | 'destructive'
  canRetry: boolean
  canRollback: boolean
  dependencies: string[]
}

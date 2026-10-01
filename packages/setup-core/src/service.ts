import type {
  SetupBlock,
  SetupBlockKind,
  SetupBlockStatus,
  SetupEvent,
  SetupSession,
} from '@navin/contracts'
import { checksum, deterministicId, SetupStore } from './store.js'
import {
  SETUP_SCHEMA_VERSION,
  type BlockDefinition,
  type CreateSetupInput,
  type SetupBlockRecord,
  type SetupClock,
  type SetupCommandErrorCode,
  type SetupDatabase,
  type SetupEventListener,
  type SetupEvidence,
  type SetupExecutor,
  type SetupRunOptions,
  type SetupSessionRecord,
  type SetupCommand,
  type StoredSetupEvent,
} from './types.js'

const BLOCKS: readonly BlockDefinition[] = [
  {
    key: 'discover',
    stage: 'DISCOVER',
    kind: 'discovery',
    status: 'ready',
    title: 'Discover the local target',
    summary: 'Inspect the loopback target and record a durable discovery result.',
    risk: 'read',
    canRetry: true,
    canRollback: false,
    dependencies: [],
  },
  {
    key: 'plan',
    stage: 'PLAN',
    kind: 'plan',
    status: 'pending',
    title: 'Build the setup plan',
    summary: 'Turn discovery into an explicit intended state.',
    risk: 'staged',
    canRetry: true,
    canRollback: false,
    dependencies: ['discover'],
  },
  {
    key: 'diff',
    stage: 'PLAN',
    kind: 'diff',
    status: 'pending',
    title: 'Review the exact diff',
    summary: 'Show the changes before any mutation is allowed.',
    risk: 'shared',
    canRetry: true,
    canRollback: false,
    dependencies: ['plan'],
  },
  {
    key: 'approve',
    stage: 'APPROVAL',
    kind: 'approval',
    status: 'pending',
    title: 'Approve the setup diff',
    summary: 'Record explicit Control approval for the shared setup change.',
    risk: 'shared',
    canRetry: false,
    canRollback: false,
    dependencies: ['diff'],
  },
  {
    key: 'apply',
    stage: 'APPLY',
    kind: 'action',
    status: 'pending',
    title: 'Apply the approved setup',
    summary: 'Apply the loopback engine mutation exactly once.',
    risk: 'shared',
    canRetry: true,
    canRollback: true,
    dependencies: ['approve'],
  },
  {
    key: 'verify',
    stage: 'VERIFY_INFRA',
    kind: 'verification',
    status: 'pending',
    title: 'Verify the applied state',
    summary: 'Read the authoritative loopback state and preserve evidence.',
    risk: 'read',
    canRetry: true,
    canRollback: false,
    dependencies: ['apply'],
  },
]

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed', 'abandoned'])

export class SetupCommandError extends Error {
  readonly code: SetupCommandErrorCode

  constructor(code: SetupCommandErrorCode, message: string) {
    super(message)
    this.name = 'SetupCommandError'
    this.code = code
  }
}

export class SetupService {
  private readonly store: SetupStore
  private readonly listeners = new Map<string, Set<SetupEventListener>>()
  private readonly executor: SetupExecutor

  constructor(
    private readonly db: SetupDatabase,
    private readonly clock: SetupClock,
    executor?: SetupExecutor,
  ) {
    this.store = new SetupStore(db)
    this.store.migrate()
    this.executor = executor ?? new LoopbackSetupExecutor()
  }

  create(input: CreateSetupInput): SetupSession {
    const title = input.title.trim()
    if (!title) throw new SetupCommandError('VALIDATION_FAILED', 'Setup title is required')
    const createdAt = this.clock.nowIso()
    const id = deterministicId('set', { title, targetHost: input.targetHost ?? { kind: 'local' } })
    const existing = this.store.getSession(id)
    if (existing) return this.publicSession(existing)
    const session = this.makeSession(id, title, input, createdAt)
    const blockDefs = input.blocks ?? BLOCKS
    const blocks = blockDefs.map((definition) => {
      const def =
        input.destructive && (definition.key === 'approve' || definition.key === 'apply')
          ? { ...definition, risk: 'destructive' as const }
          : definition
      return this.makeBlock(id, def, createdAt)
    })
    this.store.createSession(session, blocks)
    this.publish(id, 'setup.session.created', { sessionId: id, details: { revision: 1 } })
    return this.publicSession(this.require(id))
  }

  list(): SetupSession[] {
    return this.store.listSessions().map((session) => this.publicSession(session))
  }

  get(id: string): SetupSession {
    return this.publicSession(this.require(id))
  }

  resume(id: string): SetupSession {
    const session = this.require(id)
    this.db.transaction(() => {
      for (const block of session.blocks) {
        if (block.status === 'running' || block.status === 'retrying') {
          if (
            block.kind === 'action' &&
            this.store.hasLoopbackMutation(id, block.id, 'setup.apply.v1')
          ) {
            this.transitionBlock(session, block, 'passed', { resumedAfterRestart: true })
          } else {
            this.transitionBlock(session, block, 'ready', { resumedAfterRestart: true })
          }
        }
      }
      this.recomputeSession(session)
    })
    this.publish(id, 'setup.session.resumed', {
      sessionId: id,
      details: { cursor: session.eventCursor },
    })
    return this.publicSession(this.require(id))
  }

  run(id: string, command: SetupCommand, options: SetupRunOptions = {}): SetupSession {
    const session = this.require(id)
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      return this.publicSession(session)
    }
    const block = this.blockForCommand(session, command)
    if (block.status === 'passed') return this.publicSession(session)
    this.assertDependencies(session, block)

    if (block.risk === 'destructive' && (command === 'approve' || command === 'apply')) {
      const expected = `confirm ${session.id}`
      if (options.force && options.confirmation !== expected) {
        throw new SetupCommandError(
          'TYPED_CONFIRMATION_REQUIRED',
          `Tier 3 ${command} requires typed confirmation "${expected}"; never bypassed by force/yes`,
        )
      }
      if (!options.confirmation || options.confirmation.trim() !== expected) {
        throw new SetupCommandError(
          'TYPED_CONFIRMATION_REQUIRED',
          `Tier 3 ${command} requires typed confirmation "${expected}"`,
        )
      }
      if (!options.sessionAssurance) {
        throw new SetupCommandError(
          'STEP_UP_REQUIRED',
          'Tier 3 operation requires recent authentication (step-up)',
        )
      }
      const { assuranceLevel, lastAuthenticatedAt } = options.sessionAssurance
      const allowedAssurance =
        assuranceLevel === 'mfa_verified' || assuranceLevel === 'step_up_recent'
      const authTime = new Date(lastAuthenticatedAt).getTime()
      const nowMs = new Date(this.clock.nowIso()).getTime()
      const isRecent =
        Number.isFinite(authTime) && nowMs - authTime >= 0 && nowMs - authTime <= 10 * 60 * 1000
      if (!allowedAssurance || !isRecent) {
        throw new SetupCommandError(
          'STEP_UP_REQUIRED',
          'Tier 3 operation requires recent authentication (step-up)',
        )
      }
    }

    const now = this.clock.nowIso()
    this.db.transaction(() => {
      this.transitionBlock(session, block, 'running', { command })
      let output: Record<string, unknown>
      switch (command) {
        case 'discover':
          output = this.executor.discover({ sessionId: id, targetHost: session.targetHost })
          break
        case 'plan':
          output = this.executor.plan({
            sessionId: id,
            discovery: this.outputOf(session, 'discover'),
          })
          break
        case 'diff':
          output = this.executor.diff({ sessionId: id, plan: this.outputOf(session, 'plan') })
          break
        case 'approve':
          output = { approved: true, approvedAt: now, risk: 'shared' }
          break
        case 'apply':
          output = this.executor.apply({
            sessionId: id,
            diff: this.outputOf(session, 'diff'),
            database: this.db,
            now,
          })
          break
        case 'verify':
          output = this.executor.verify({
            sessionId: id,
            applied: this.outputOf(session, 'apply'),
            database: this.db,
          })
          break
      }
      this.completeBlock(session, block, output, now)
      this.recomputeSession(session)
    })
    return this.publicSession(this.require(id))
  }

  subscribe(id: string, listener: SetupEventListener): () => void {
    this.require(id)
    const listeners = this.listeners.get(id) ?? new Set<SetupEventListener>()
    listeners.add(listener)
    this.listeners.set(id, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(id)
    }
  }

  eventsSince(id: string, cursor = 0): StoredSetupEvent[] {
    this.require(id)
    return this.store.eventsSince(id, cursor)
  }

  /** Exposes durable metadata to tests and internal adapters without changing the frozen API contract. */
  getRecord(id: string): SetupSessionRecord {
    return this.require(id)
  }

  private makeSession(
    id: string,
    title: string,
    input: CreateSetupInput,
    now: string,
  ): SetupSessionRecord {
    const base = {
      id,
      title,
      currentStage: input.initialStage ?? 'DISCOVER',
      status: 'active',
      intelligenceMode: input.intelligenceMode ?? 'none',
      targetHost: input.targetHost ?? { kind: 'local' },
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }
    return { ...base, blocks: [], checksum: checksum(base) } as SetupSessionRecord
  }

  private makeBlock(id: string, definition: BlockDefinition, now: string): SetupBlockRecord {
    const blockBase = {
      id: deterministicId('blk', { sessionId: id, key: definition.key }),
      sessionId: id,
      schemaVersion: SETUP_SCHEMA_VERSION,
      stage: definition.stage,
      kind: definition.kind,
      status: definition.status,
      title: definition.title,
      summary: definition.summary,
      inputSchema: { type: 'object', additionalProperties: true },
      risk: definition.risk,
      canRetry: definition.canRetry,
      canRollback: definition.canRollback,
      dependencies: definition.dependencies.map((key) =>
        deterministicId('blk', { sessionId: id, key }),
      ),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }
    return {
      ...blockBase,
      checksum: checksum(blockBase),
      metadata: { revision: 1, checksum: checksum(blockBase), evidence: [] },
    } as SetupBlockRecord
  }

  private blockForCommand(session: SetupSessionRecord, command: SetupCommand): SetupBlockRecord {
    const kindMap: Record<SetupCommand, SetupBlockKind> = {
      discover: 'discovery',
      plan: 'plan',
      diff: 'diff',
      approve: 'approval',
      apply: 'action',
      verify: 'verification',
    }
    const targetKind = kindMap[command]
    const block = session.blocks.find((item) => item.kind === targetKind)
    if (!block) throw new SetupCommandError('NOT_FOUND', `Setup block ${command} does not exist`)
    return block
  }

  private assertDependencies(session: SetupSessionRecord, block: SetupBlockRecord): void {
    for (const dependencyId of block.dependencies) {
      const dependency = session.blocks.find((candidate) => candidate.id === dependencyId)
      if (!dependency || dependency.status !== 'passed') {
        throw new SetupCommandError(
          'BLOCKED',
          `${block.title} is blocked by an incomplete dependency`,
        )
      }
    }
  }

  private completeBlock(
    session: SetupSessionRecord,
    block: SetupBlockRecord,
    output: Record<string, unknown>,
    now: string,
  ): void {
    const nextRevision = block.revision + 1
    const evidence: SetupEvidence = {
      id: deterministicId('evi', { blockId: block.id, revision: nextRevision, output }),
      status: 'passed',
      kind: `${block.kind}.observed`,
      details: output,
      observedAt: now,
      checksum: checksum(output),
    }
    const value = { output, setup: { revision: nextRevision, checksum: checksum(output) } }
    const next = {
      ...block,
      status: 'passed' as const,
      value,
      evidenceIds: [
        evidence.id as SetupBlock['evidenceIds'] extends (infer T)[] | undefined ? T : never,
      ],
      updatedAt: now,
      revision: nextRevision,
      checksum: checksum({
        ...block,
        status: 'passed',
        value,
        evidenceIds: [evidence.id],
        revision: nextRevision,
        updatedAt: now,
      }),
      metadata: {
        revision: nextRevision,
        checksum: checksum(output),
        output,
        evidence: [evidence],
      },
    }
    this.store.addEvidence(evidence, session.id, block.id)
    Object.assign(block, next)
    this.store.updateBlock(block)
    this.publish(session.id, 'setup.block.updated', {
      sessionId: session.id,
      blockId: block.id,
      stage: block.stage,
      previousStatus: 'running',
      newStatus: 'passed',
      details: { revision: block.revision, checksum: block.checksum, evidenceId: evidence.id },
    })
  }

  private transitionBlock(
    session: SetupSessionRecord,
    block: SetupBlockRecord,
    status: SetupBlockStatus,
    details: Record<string, unknown>,
  ): void {
    const previousStatus = block.status
    if (previousStatus === status) return
    const now = this.clock.nowIso()
    const nextRevision = block.revision + 1
    const next = { ...block, status, updatedAt: now, revision: nextRevision }
    next.checksum = checksum({ ...next, metadata: undefined })
    next.metadata = { ...block.metadata, revision: nextRevision, checksum: next.checksum }
    Object.assign(block, next)
    this.store.updateBlock(block)
    this.publish(session.id, 'setup.block.updated', {
      sessionId: session.id,
      blockId: block.id,
      stage: block.stage,
      previousStatus,
      newStatus: status,
      details: { ...details, revision: block.revision, checksum: block.checksum },
    })
  }

  private recomputeSession(session: SetupSessionRecord): void {
    const now = this.clock.nowIso()
    const completed = session.blocks.filter((block) => block.status === 'passed').length
    const firstOpen = session.blocks.find((block) => block.status !== 'passed')
    const currentStage = firstOpen?.stage ?? 'READY'
    const status = completed === session.blocks.length ? 'completed' : 'active'
    session.currentStage = currentStage
    session.status = status
    session.updatedAt = now
    session.revision += 1
    session.checksum = checksum({
      id: session.id,
      currentStage,
      status,
      revision: session.revision,
      blockChecksums: session.blocks.map((block) => block.checksum),
    })
    this.store.updateSession(session)
    this.publish(session.id, 'setup.session.updated', {
      sessionId: session.id,
      stage: currentStage,
      details: { status, revision: session.revision, completedBlocks: completed },
    })
  }

  private outputOf(session: SetupSessionRecord, key: string): unknown {
    const targetKind =
      key === 'discover'
        ? 'discovery'
        : key === 'apply'
          ? 'action'
          : key === 'approve'
            ? 'approval'
            : key === 'verify'
              ? 'verification'
              : key
    const block = session.blocks.find((candidate) => candidate.kind === targetKind)
    if (!block || !block.value || typeof block.value !== 'object') return undefined
    const value = block.value as Record<string, unknown>
    return value.output
  }

  private publish(
    sessionId: string,
    kind: string,
    payload: Omit<SetupEvent['payload'], 'sessionId'> & { sessionId: string },
  ): void {
    const event: SetupEvent = {
      apiVersion: '1',
      kind,
      id: deterministicId('evt', { sessionId, kind, payload, at: this.clock.nowIso() }),
      timestamp: this.clock.nowIso(),
      payload: payload as SetupEvent['payload'],
    }
    const stored = this.store.addEvent(sessionId, event)
    const session = this.store.getSession(sessionId)
    if (session) {
      session.eventCursor = String(stored.seq)
      session.updatedAt = event.timestamp
      session.checksum = checksum({
        ...session,
        blocks: session.blocks.map((block) => block.checksum),
      })
      this.store.updateSession(session)
    }
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event, stored)
  }

  private require(id: string): SetupSessionRecord {
    const session = this.store.getSession(id)
    if (!session) throw new SetupCommandError('NOT_FOUND', `Setup session ${id} was not found`)
    return session
  }

  private publicSession(session: SetupSessionRecord): SetupSession {
    return {
      id: session.id,
      title: session.title,
      currentStage: session.currentStage,
      status: session.status,
      intelligenceMode: session.intelligenceMode,
      ...(session.targetHost ? { targetHost: session.targetHost } : {}),
      blocks: session.blocks.map((block) => this.publicBlock(block)),
      ...(session.eventCursor ? { eventCursor: session.eventCursor } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  private publicBlock(block: SetupBlockRecord): SetupBlock {
    return {
      id: block.id,
      sessionId: block.sessionId,
      schemaVersion: block.schemaVersion,
      stage: block.stage,
      kind: block.kind,
      status: block.status,
      title: block.title,
      summary: block.summary,
      ...(block.inputSchema ? { inputSchema: block.inputSchema } : {}),
      ...(block.value === undefined ? {} : { value: block.value }),
      ...(block.evidenceIds ? { evidenceIds: block.evidenceIds } : {}),
      ...(block.risk ? { risk: block.risk } : {}),
      canRetry: block.canRetry,
      canRollback: block.canRollback,
      dependencies: block.dependencies,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    }
  }
}

class LoopbackSetupExecutor implements SetupExecutor {
  discover(input: {
    sessionId: string
    targetHost?: SetupSession['targetHost']
  }): Record<string, unknown> {
    return {
      target: input.targetHost ?? { kind: 'local' },
      engine: 'loopback-fixture',
      process: 'navind',
      sessionId: input.sessionId,
      observed: true,
    }
  }

  plan(input: { sessionId: string; discovery: unknown }): Record<string, unknown> {
    return {
      sessionId: input.sessionId,
      desired: { setupMarker: `navin:${input.sessionId}` },
      basedOn: checksum(input.discovery),
    }
  }

  diff(input: { sessionId: string; plan: unknown }): Record<string, unknown> {
    return {
      sessionId: input.sessionId,
      changes: [{ path: 'loopback.setupMarker', op: 'add', newValue: `navin:${input.sessionId}` }],
      planChecksum: checksum(input.plan),
    }
  }

  apply(input: {
    sessionId: string
    diff: unknown
    database: SetupDatabase
    now: string
  }): Record<string, unknown> {
    const blockId = deterministicId('blk', { sessionId: input.sessionId, key: 'apply' })
    const inserted = new SetupStore(input.database).insertLoopbackMutation(
      input.sessionId,
      blockId,
      'setup.apply.v1',
      input.now,
      { marker: `navin:${input.sessionId}`, diffChecksum: checksum(input.diff) },
    )
    return {
      mutation: 'setup.apply.v1',
      marker: `navin:${input.sessionId}`,
      appliedNow: inserted,
      idempotent: !inserted,
    }
  }

  verify(input: {
    sessionId: string
    applied: unknown
    database: SetupDatabase
  }): Record<string, unknown> {
    const blockId = deterministicId('blk', { sessionId: input.sessionId, key: 'apply' })
    const present = new SetupStore(input.database).hasLoopbackMutation(
      input.sessionId,
      blockId,
      'setup.apply.v1',
    )
    if (!present) throw new SetupCommandError('BLOCKED', 'Loopback mutation is not present')
    return { verified: true, mutation: 'setup.apply.v1', applied: input.applied }
  }
}

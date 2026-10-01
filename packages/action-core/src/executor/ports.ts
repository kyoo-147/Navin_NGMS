import type {
  ActionDiff,
  ActionVerification,
  Job,
  JobProgress,
  NavinSurface,
} from '@navin/contracts'

export interface ExecutorEmitInput {
  kind: string
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface ExecutorContext {
  actionId: string
  surface: NavinSurface
  signal?: AbortSignal
  /**
   * Durable execution attempt id. Adapters can use it (with `idempotencyKey`) to
   * deduplicate a side effect that may have been dispatched before a crash.
   */
  attemptId?: string
  /** Stable per-action key used by the external executor for deduplication. */
  idempotencyKey?: string
  /** Optional caller key retained separately for control-plane conflict handling. */
  callerIdempotencyKey?: string
  emitEvent?: (input: ExecutorEmitInput) => void
  reportProgress?: (progress: JobProgress) => void
}

export interface ActionApplyResult {
  result?: Record<string, unknown>
  canRollback?: boolean
}

/**
 * Port for real infrastructure work. The ledger only ever calls these methods;
 * it never mutates infrastructure itself. Adapters (engine, DNS, backup, ...)
 * implement this port outside `action-core`.
 */
export interface ActionExecutorPort {
  readonly name: string
  discover?(
    parameters: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<Record<string, unknown> | void>
  plan?(parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<ActionDiff>
  apply(
    parameters: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ActionApplyResult | void>
  verify?(parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<ActionVerification>
  rollback?(parameters: Record<string, unknown>, ctx: ExecutorContext): Promise<void>
}

export interface JobHandlerContext {
  jobId: string
  signal?: AbortSignal
  reportProgress: (progress: JobProgress) => void
  emitEvent: (input: ExecutorEmitInput) => void
}

export interface JobHandlerPort {
  readonly name: string
  run(job: Job, ctx: JobHandlerContext): Promise<Record<string, unknown> | void>
}

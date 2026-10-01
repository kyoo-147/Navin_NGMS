import { createHash, randomUUID } from 'node:crypto'
import type { EngineResourceKind } from './resources.js'

export type EngineChangeOp = 'create' | 'update' | 'delete' | 'noop'
export type EngineDiffOp = 'add' | 'replace' | 'remove'
export type EngineRiskTier = 0 | 1 | 2

export interface EngineDiffChange {
  path: string
  op: EngineDiffOp
  oldValue?: unknown
  newValue?: unknown
}

export interface EnginePlanDiff {
  summary: string
  changes: EngineDiffChange[]
}

export interface EnginePlanStep {
  id: string
  op: EngineChangeOp
  kind: EngineResourceKind
  target: string
  desired: Record<string, unknown>
  observed?: Record<string, unknown>
  observedId?: string
  reason?: string
}

export interface EnginePlan {
  planId: string
  kind: EngineResourceKind
  idempotencyKey: string
  createdAt: string
  riskTier: EngineRiskTier
  canRollback: boolean
  noOp: boolean
  diff: EnginePlanDiff
  steps: EnginePlanStep[]
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function computeChanges(
  desired: Record<string, unknown>,
  observed?: Record<string, unknown>,
): EngineDiffChange[] {
  const changes: EngineDiffChange[] = []
  for (const key of Object.keys(desired)) {
    const newValue = desired[key]
    const hasObserved =
      observed !== undefined && Object.prototype.hasOwnProperty.call(observed, key)
    const oldValue = hasObserved ? observed?.[key] : undefined
    if (!hasObserved) {
      changes.push({ path: key, op: 'add', newValue })
    } else if (stableStringify(oldValue) !== stableStringify(newValue)) {
      changes.push({ path: key, op: 'replace', oldValue, newValue })
    }
  }
  return changes
}

export function changesAreSatisfied(
  desired: Record<string, unknown>,
  observed?: Record<string, unknown>,
): boolean {
  return computeChanges(desired, observed).length === 0
}

export function createIdempotencyKey(
  kind: EngineResourceKind,
  target: string,
  desired: Record<string, unknown>,
): string {
  const digest = createHash('sha256')
    .update(`${kind}\u0000${target}\u0000${stableStringify(desired)}`)
    .digest('hex')
  return `eng_${digest.slice(0, 40)}`
}

function riskTierForOp(op: EngineChangeOp): EngineRiskTier {
  if (op === 'noop') return 0
  if (op === 'delete') return 2
  return 1
}

function summarize(
  kind: EngineResourceKind,
  target: string,
  op: EngineChangeOp,
  changeCount: number,
): string {
  if (op === 'noop') return `No changes for ${kind} ${target}`
  if (op === 'create') return `Create ${kind} ${target}`
  if (op === 'delete') return `Delete ${kind} ${target}`
  return `Update ${kind} ${target} (${changeCount} change${changeCount === 1 ? '' : 's'})`
}

export interface BuildPlanInput {
  kind: EngineResourceKind
  target: string
  desired: Record<string, unknown>
  observed?: Record<string, unknown>
  observedId?: string
  reason?: string
}

export function buildPlan(input: BuildPlanInput): EnginePlan {
  const changes = computeChanges(input.desired, input.observed)
  const op: EngineChangeOp =
    input.observed === undefined ? 'create' : changes.length > 0 ? 'update' : 'noop'

  const step: EnginePlanStep = {
    id: `${input.kind}:${input.target}`,
    op,
    kind: input.kind,
    target: input.target,
    desired: input.desired,
  }
  if (input.observed !== undefined) step.observed = input.observed
  if (input.observedId !== undefined) step.observedId = input.observedId
  if (input.reason !== undefined) step.reason = input.reason

  return {
    planId: `pln_${randomUUID()}`,
    kind: input.kind,
    idempotencyKey: createIdempotencyKey(input.kind, input.target, input.desired),
    createdAt: new Date().toISOString(),
    riskTier: riskTierForOp(op),
    canRollback: op !== 'noop',
    noOp: op === 'noop',
    diff: {
      summary: summarize(input.kind, input.target, op, changes.length),
      changes,
    },
    steps: [step],
  }
}

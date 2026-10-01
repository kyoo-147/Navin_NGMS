import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActionDiff } from '@navin/contracts'

import { ActionCore } from '../src/index.js'
import type { ActionExecutorPort, ExecutorContext } from '../src/index.js'

export function createTempDir(prefix = 'navin-action-core-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

export function openCore(dir: string, name = 'ledger.db'): ActionCore {
  return ActionCore.open({ path: join(dir, name) })
}

export interface RecordingExecutor extends ActionExecutorPort {
  calls: string[]
  appliedParameters: Array<Record<string, unknown>>
  contexts: ExecutorContext[]
}

export interface RecordingExecutorOptions {
  name?: string
  failApply?: Error
  failRollback?: Error
  failVerify?: Error
  /** Omit verify() entirely to exercise the "cannot verify" guard. */
  withoutVerify?: boolean
  verifyPassed?: boolean
  metadataOnlyVerify?: boolean
  canRollback?: boolean
  planDiff?: ActionDiff
  onApply?: (parameters: Record<string, unknown>, ctx: ExecutorContext) => void | Promise<void>
}

export function createRecordingExecutor(options: RecordingExecutorOptions = {}): RecordingExecutor {
  const name = options.name ?? 'test.echo'
  const calls: string[] = []
  const appliedParameters: Array<Record<string, unknown>> = []
  const contexts: ExecutorContext[] = []

  const executor: RecordingExecutor = {
    name,
    calls,
    appliedParameters,
    contexts,
    async plan(parameters, ctx) {
      calls.push('plan')
      contexts.push(ctx)
      return (
        options.planDiff ?? {
          summary: `apply ${name}`,
          changes: [
            { path: '/value', op: 'replace', oldValue: null, newValue: parameters.value ?? null },
          ],
        }
      )
    },
    async apply(parameters, ctx) {
      calls.push('apply')
      appliedParameters.push(parameters)
      contexts.push(ctx)
      if (options.onApply !== undefined) {
        await options.onApply(parameters, ctx)
      }
      if (options.failApply !== undefined) {
        throw options.failApply
      }
      return {
        result: { applied: true, value: parameters.value ?? null },
        canRollback: options.canRollback ?? true,
      }
    },
    async rollback(_parameters, ctx) {
      calls.push('rollback')
      contexts.push(ctx)
      if (options.failRollback !== undefined) {
        throw options.failRollback
      }
    },
  }

  if (options.withoutVerify !== true) {
    executor.verify = async (_parameters, ctx) => {
      calls.push('verify')
      contexts.push(ctx)
      if (options.failVerify !== undefined) {
        throw options.failVerify
      }
      return {
        command: `${name}.verify`,
        expected: true,
        ...(options.metadataOnlyVerify ? {} : { actual: true }),
        passed: options.verifyPassed ?? true,
      }
    }
  }

  return executor
}

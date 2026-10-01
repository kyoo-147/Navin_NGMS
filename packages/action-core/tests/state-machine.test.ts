import { describe, expect, it } from 'vitest'

import {
  ACTION_TRANSITIONS,
  ActionCoreError,
  LIFECYCLE_ORDER,
  assertStageForStatus,
  assertTransition,
  canonicalStageForStatus,
  canTransition,
  isStageAllowedForStatus,
  isTerminalStatus,
  lifecycleIndex,
} from '../src/index.js'

describe('action state machine', () => {
  it('permits the canonical forward lifecycle', () => {
    expect(canTransition('staged', 'planned')).toBe(true)
    expect(canTransition('planned', 'awaiting_approval')).toBe(true)
    expect(canTransition('awaiting_approval', 'approved')).toBe(true)
    expect(canTransition('approved', 'applying')).toBe(true)
    expect(canTransition('applying', 'verifying')).toBe(true)
    expect(canTransition('verifying', 'completed')).toBe(true)
    expect(canTransition('completed', 'rolling_back')).toBe(true)
    expect(canTransition('rolling_back', 'rolled_back')).toBe(true)
  })

  it('rejects illegal jumps', () => {
    expect(canTransition('staged', 'completed')).toBe(false)
    expect(canTransition('staged', 'verifying')).toBe(false)
    expect(canTransition('rejected', 'applying')).toBe(false)
    expect(canTransition('rolled_back', 'rolling_back')).toBe(false)
    expect(() => assertTransition('staged', 'completed')).toThrowError(ActionCoreError)
  })

  it('maps statuses to their canonical stage and validates pairs', () => {
    expect(canonicalStageForStatus('staged')).toBe('discover')
    expect(canonicalStageForStatus('planned')).toBe('plan')
    expect(canonicalStageForStatus('applying')).toBe('apply')
    expect(canonicalStageForStatus('completed')).toBe('result')
    expect(canonicalStageForStatus('rolling_back')).toBe('rollback')

    expect(isStageAllowedForStatus('awaiting_approval', 'approve')).toBe(true)
    expect(isStageAllowedForStatus('awaiting_approval', 'result')).toBe(false)
    expect(() => assertStageForStatus('completed', 'apply')).toThrowError(ActionCoreError)
  })

  it('identifies terminal statuses and lifecycle ordering', () => {
    expect(isTerminalStatus('rejected')).toBe(true)
    expect(isTerminalStatus('rolled_back')).toBe(true)
    expect(isTerminalStatus('rollback_failed')).toBe(true)
    expect(isTerminalStatus('applying')).toBe(false)

    expect(LIFECYCLE_ORDER[0]).toBe('discover')
    expect(lifecycleIndex('rollback')).toBe(LIFECYCLE_ORDER.length - 1)
    expect(lifecycleIndex('apply')).toBeGreaterThan(lifecycleIndex('approve'))
  })

  it('defines a transition list for every status', () => {
    for (const status of Object.keys(ACTION_TRANSITIONS)) {
      expect(Array.isArray(ACTION_TRANSITIONS[status as keyof typeof ACTION_TRANSITIONS])).toBe(
        true,
      )
    }
  })
})

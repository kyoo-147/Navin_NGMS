import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateStatus, exitCodeFor, isStatus, STATUS } from '../src/status.mjs'

test('aggregateStatus is fail-closed with precedence FAIL > BLOCKED > NOT_RUN > PASS', () => {
  assert.equal(aggregateStatus([]), STATUS.NOT_RUN)
  assert.equal(aggregateStatus([STATUS.PASS, STATUS.PASS]), STATUS.PASS)
  assert.equal(aggregateStatus([STATUS.PASS, STATUS.NOT_RUN]), STATUS.NOT_RUN)
  assert.equal(aggregateStatus([STATUS.PASS, STATUS.BLOCKED, STATUS.NOT_RUN]), STATUS.BLOCKED)
  assert.equal(aggregateStatus([STATUS.BLOCKED, STATUS.FAIL]), STATUS.FAIL)
})

test('exit codes are stable and unknown statuses fail closed', () => {
  assert.equal(exitCodeFor(STATUS.PASS), 0)
  assert.equal(exitCodeFor(STATUS.FAIL), 1)
  assert.equal(exitCodeFor(STATUS.BLOCKED), 2)
  assert.equal(exitCodeFor(STATUS.NOT_RUN), 3)
  assert.equal(exitCodeFor('UNKNOWN'), 4)
})

test('isStatus only accepts the four truthful statuses', () => {
  assert.ok(isStatus('PASS'))
  assert.ok(isStatus('NOT_RUN'))
  assert.ok(!isStatus('pass'))
  assert.ok(!isStatus('WARN'))
  assert.ok(!isStatus(null))
})

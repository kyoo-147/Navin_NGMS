import test from 'node:test'
import assert from 'node:assert/strict'
import { assertEvidenceClass, canSatisfy, EVIDENCE_CLASSES, evidenceRank } from '../src/classes.mjs'

test('unit evidence can never satisfy external or desktop requirements', () => {
  assert.equal(canSatisfy('unit', 'external'), false)
  assert.equal(canSatisfy('unit', 'desktop'), false)
  assert.equal(canSatisfy('browser', 'desktop'), false)
  assert.equal(canSatisfy('browser', 'external'), false)
  assert.equal(canSatisfy('integration', 'protocol'), false)
})

test('stronger evidence can satisfy weaker requirements but never the reverse', () => {
  assert.equal(canSatisfy('external', 'unit'), true)
  assert.equal(canSatisfy('desktop', 'browser'), true)
  assert.equal(canSatisfy('protocol', 'integration'), true)
  assert.equal(canSatisfy('protocol', 'external'), false)
})

test('evidence class ranks are unique and strictly increasing', () => {
  const ranks = Object.values(EVIDENCE_CLASSES).map((entry) => entry.rank)
  const unique = new Set(ranks)
  assert.equal(unique.size, ranks.length)
  for (let index = 1; index < ranks.length; index += 1) {
    assert.ok(ranks[index] > ranks[index - 1])
  }
})

test('assertEvidenceClass and evidenceRank reject unknown classes', () => {
  assert.throws(() => assertEvidenceClass('screenshot'), /must be one of/)
  assert.throws(() => evidenceRank('screenshot'), /must be one of/)
})

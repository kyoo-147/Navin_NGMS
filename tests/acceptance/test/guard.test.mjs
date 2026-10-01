import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuard, DEFAULT_PRODUCTION_DENY, GuardError } from '../src/guard.mjs'

const guard = createGuard()

test('production endpoints are rejected', () => {
  for (const target of [
    'mail.production.example.invalid',
    'webmail.production.example.invalid',
    'production.example.invalid',
    'alice@production.example.invalid',
    'owner@example.invalid',
    'https://mail.production.example.invalid/admin',
    'mail.production.example.invalid:993',
  ]) {
    assert.equal(guard.checkTarget(target).allowed, false, `expected reject: ${target}`)
  }
  assert.ok(DEFAULT_PRODUCTION_DENY.includes('production.example.invalid'))
})

test('local and reserved disposable targets are allowed', () => {
  for (const target of [
    'localhost',
    '127.0.0.1',
    'thing.test',
    'app.localhost',
    '203.0.113.10',
    'example.com',
    'http://localhost:5173',
  ]) {
    assert.equal(guard.checkTarget(target).allowed, true, `expected allow: ${target}`)
  }
})

test('unknown public targets are denied by default', () => {
  assert.equal(guard.checkTarget('random-public-host.net').allowed, false)
  assert.equal(guard.checkTarget('external-vm.example.net').allowed, false)
})

test('immutable deny entries always win over explicit allow entries', () => {
  for (const allow of [
    ['mail.production.example.invalid'],
    ['production.example.invalid'],
    ['owner@example.invalid'],
  ]) {
    for (const target of [
      'mail.production.example.invalid',
      'support@production.example.invalid',
      'owner@example.invalid',
    ]) {
      assert.equal(
        createGuard({ allow }).checkTarget(target).allowed,
        false,
        `deny must win for ${target} with allow ${allow.join(',')}`,
      )
    }
  }
})

test('external targets are permitted only when explicitly allow-listed', () => {
  const scoped = createGuard({ allow: ['external-vm.example.net'] })
  assert.equal(scoped.checkTarget('external-vm.example.net').allowed, true)
  assert.equal(scoped.isExplicitlyAllowed('external-vm.example.net'), 'external-vm.example.net')
  assert.equal(scoped.isExplicitlyAllowed('other.example.net'), null)
  // local/reserved is allowed, but not "explicitly" allow-listed
  assert.equal(guard.checkTarget('localhost').allowed, true)
  assert.equal(guard.isExplicitlyAllowed('localhost'), null)
})

test('assertTarget throws GuardError for a production endpoint', () => {
  assert.throws(() => guard.assertTarget('mail.production.example.invalid'), GuardError)
})

test('checkCommand and checkText flag production tokens anywhere in a command', () => {
  assert.equal(guard.checkCommand(['ssh', 'root@mail.production.example.invalid']).allowed, false)
  assert.equal(guard.checkText('nothing sensitive here').allowed, true)
  assert.deepEqual(guard.scanForDenied('send to support@production.example.invalid'), [
    'production.example.invalid',
  ])
})

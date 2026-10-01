import test from 'node:test'
import assert from 'node:assert/strict'
import { createRedactor, redactionRules } from '../src/redaction.mjs'

test('secrets are redacted from captured text', () => {
  const redactor = createRedactor()
  const sample = [
    'STALWART_TOKEN=abc123SECRETvalue',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk',
    '{"password":"hunter2","client_secret":"cs_abcdef123456"}',
    'https://svcuser:s3cr3t-pw@example.test/inbox',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const { text, matches } = redactor.redactText(sample)
  for (const secret of [
    'abc123SECRETvalue',
    'hunter2',
    'cs_abcdef123456',
    's3cr3t-pw',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  ]) {
    assert.ok(!text.includes(secret), `secret leaked: ${secret}`)
  }
  assert.match(text, /\[REDACTED/)
  assert.ok(matches.length > 0)
})

test('registered literal secrets are redacted even without a key', () => {
  const redactor = createRedactor({ secrets: ['super-secret-token-value'] })
  const { text } = redactor.redactText('value = super-secret-token-value end')
  assert.ok(!text.includes('super-secret-token-value'))
  assert.match(text, /\[REDACTED:registered-secret\]/)
})

test('redactValue masks sensitive keys and nested strings', () => {
  const redactor = createRedactor()
  const { value } = redactor.redactValue({
    password: 'hunter2',
    nested: { apiKey: 'abcdef123456', note: 'Authorization: Bearer sekrit-token-value' },
  })
  assert.equal(value.password, '[REDACTED:sensitive-key]')
  assert.equal(value.nested.apiKey, '[REDACTED:sensitive-key]')
  assert.ok(!JSON.stringify(value).includes('hunter2'))
  assert.ok(!JSON.stringify(value).includes('sekrit-token-value'))
})

test('redactionRules lists the expected rules', () => {
  assert.ok(redactionRules().includes('jwt'))
  assert.ok(redactionRules().includes('secret-assignment'))
})

test('quoted secrets containing spaces, commas and semicolons are fully redacted', () => {
  const redactor = createRedactor()
  const secrets = ['my secret, with; stuff', 'p@ss word, and; more', 'tab\tand space value']
  const samples = [
    'password: "my secret, with; stuff"',
    "client_secret='p@ss word, and; more'",
    'token = "tab\tand space value"',
  ]
  for (const sample of samples) {
    const { text } = redactor.redactText(sample)
    assert.match(text, /\[REDACTED:secret\]/)
    for (const secret of secrets) {
      assert.ok(!text.includes(secret), `leaked "${secret}" from ${sample}`)
    }
    for (const fragment of ['with;', 'and;', 'word,', 'stuff', 'more']) {
      if (sample.includes(fragment)) {
        assert.ok(!text.includes(fragment), `partial leak "${fragment}" from ${sample}`)
      }
    }
  }
})

test('JSON secret values (including quoted keys) are fully redacted', () => {
  const redactor = createRedactor()
  const samples = [
    '{"password":"p@ss word, with; stuff","user":"a"}',
    '{"apiKey":"key with spaces; and, commas"}',
    "{'auth_token':'single quoted; secret, value'}",
  ]
  for (const sample of samples) {
    const { text } = redactor.redactText(sample)
    assert.ok(!text.includes('p@ss word'), sample)
    assert.ok(!text.includes('with; stuff'), sample)
    assert.ok(!text.includes('key with spaces'), sample)
    assert.ok(!text.includes('single quoted; secret, value'), sample)
    assert.match(text, /\[REDACTED:secret\]/)
  }
})

test('escaped quotes inside a quoted secret do not truncate redaction', () => {
  const redactor = createRedactor()
  const { text } = redactor.redactText('password="has \\"escaped\\" quote inside"')
  assert.ok(!text.includes('escaped'))
  assert.ok(!text.includes('quote inside'))
  assert.match(text, /\[REDACTED:secret\]/)
})

test('Authorization Basic credentials are redacted entirely', () => {
  const redactor = createRedactor()
  const encoded = Buffer.from('user:pa ss,;value').toString('base64')
  const sample = `Authorization: Basic ${encoded}`
  const { text } = redactor.redactText(sample)
  assert.ok(!text.includes(encoded), 'basic credential leaked')
  assert.match(text, /Authorization: Basic \[REDACTED:authorization\]/)
})

test('redactValue fully redacts a quoted secret embedded in an arbitrary string', () => {
  const redactor = createRedactor()
  const { value } = redactor.redactValue({ note: 'set password: "space, comma; semicolon"' })
  assert.ok(!JSON.stringify(value).includes('space, comma; semicolon'))
  assert.match(value.note, /\[REDACTED:secret\]/)
})

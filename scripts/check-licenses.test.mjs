import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import checker module
import {
  validateRecord,
  validatePolicy,
  checkAllReferences,
  loadPolicy,
  resolveLocalCheckoutDir,
  verifyLocalCommit,
} from './check-licenses.mjs';

test('policy.json is well-formed and valid', () => {
  const policyPath = path.join(rootDir, 'config', 'licenses', 'policy.json');
  const policy = loadPolicy(policyPath);
  const result = validatePolicy(policy);
  assert.equal(result.valid, true, `Policy validation failed: ${result.errors.join(', ')}`);
});

test('valid-record.json fixture passes validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'valid-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, true, `Valid fixture failed: ${result.errors.join(', ')}`);
});

test('missing-field-record.json fixture fails validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'missing-field-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, false, 'Expected validation to fail for missing fields');
  assert.ok(
    result.errors.some(e => e.includes('pinned_commit')),
    `Errors should mention missing pinned_commit: ${result.errors.join(', ')}`
  );
});

test('code-imported-true-record.json fixture fails validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'code-imported-true-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, false, 'Expected validation to fail for code_imported: true');
  assert.ok(
    result.errors.some(e => e.toLowerCase().includes('code_imported')),
    `Errors should mention code_imported: ${result.errors.join(', ')}`
  );
});

test('unknown-license-record.json fixture fails validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'unknown-license-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, false, 'Expected validation to fail for unknown license');
  assert.ok(
    result.errors.some(e => e.toLowerCase().includes('license')),
    `Errors should mention license: ${result.errors.join(', ')}`
  );
});

test('invalid-commit-record.json fixture fails validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'invalid-commit-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, false, 'Expected validation to fail for invalid commit');
  assert.ok(
    result.errors.some(e => e.toLowerCase().includes('commit')),
    `Errors should mention commit: ${result.errors.join(', ')}`
  );
});

test('invalid-category-record.json fixture fails validation', () => {
  const fixturePath = path.join(rootDir, 'config', 'licenses', 'fixtures', 'invalid-category-record.json');
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const policy = loadPolicy(path.join(rootDir, 'config', 'licenses', 'policy.json'));
  const result = validateRecord(record, policy);
  assert.equal(result.valid, false, 'Expected validation to fail for invalid category');
  assert.ok(
    result.errors.some(e => e.toLowerCase().includes('category')),
    `Errors should mention category: ${result.errors.join(', ')}`
  );
});

test('all docs/references/*.json records pass validation', () => {
  const referencesDir = path.join(rootDir, 'docs', 'references');
  const policyPath = path.join(rootDir, 'config', 'licenses', 'policy.json');
  const summary = checkAllReferences(referencesDir, policyPath, { verifyLocalCommits: true });
  assert.equal(summary.failed, 0, `Validation failed on references: ${JSON.stringify(summary.errors, null, 2)}`);
  assert.ok(summary.total >= 15, `Expected at least 15 reference records, found ${summary.total}`);
  // Verify all records were locally verified in git
  for (const r of summary.records) {
    assert.equal(r.localVerified, true, `Record ${r.id} was not verified against local checkout git cache`);
  }
});

test('resolveLocalCheckoutDir finds local cache', () => {
  const dir = resolveLocalCheckoutDir('https://github.com/stalwartlabs/stalwart.git');
  assert.ok(dir, 'Expected stalwart checkout to be resolved in local cache');
  assert.ok(fs.existsSync(dir), `Resolved directory must exist: ${dir}`);
});

test('verifyLocalCommit detects nonexistent commit in cached repo', () => {
  const record = {
    url: 'https://github.com/stalwartlabs/stalwart.git',
    pinned_commit: '0000000000000000000000000000000000000000',
  };
  const result = verifyLocalCommit(record);
  assert.equal(result.checked, true);
  assert.equal(result.verified, false);
});

test('checkAllReferences includes rich verbose metadata for records', () => {
  const referencesDir = path.join(rootDir, 'docs', 'references');
  const policyPath = path.join(rootDir, 'config', 'licenses', 'policy.json');
  const summary = checkAllReferences(referencesDir, policyPath, { verifyLocalCommits: true });
  const stalwart = summary.records.find(r => r.id === 'stalwart');
  assert.ok(stalwart, 'Expected stalwart record in summary');
  assert.equal(stalwart.category, 'external-engine');
  assert.ok(stalwart.role && stalwart.role.length > 0);
  assert.ok(Array.isArray(stalwart.studiedPaths) && stalwart.studiedPaths.length > 0);
  assert.ok(stalwart.studiedBehavior && stalwart.studiedBehavior.length > 0);
  assert.ok(Array.isArray(stalwart.caveats) && stalwart.caveats.length > 0);
  assert.ok(stalwart.localMessage && stalwart.localMessage.length > 0);
});

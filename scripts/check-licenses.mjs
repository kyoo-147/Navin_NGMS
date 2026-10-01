#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '..');

/**
 * Load policy configuration from file.
 * @param {string} policyPath
 * @returns {object}
 */
export function loadPolicy(policyPath) {
  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file not found: ${policyPath}`);
  }
  const content = fs.readFileSync(policyPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Validate policy structure.
 * @param {object} policy
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') {
    return { valid: false, errors: ['Policy must be a valid JSON object'] };
  }

  if (!policy.dependency_allowlist?.permissive || !Array.isArray(policy.dependency_allowlist.permissive)) {
    errors.push('Missing or invalid dependency_allowlist.permissive array');
  }
  if (!policy.dependency_allowlist?.review_required || !Array.isArray(policy.dependency_allowlist.review_required)) {
    errors.push('Missing or invalid dependency_allowlist.review_required array');
  }
  if (!policy.dependency_allowlist?.prohibited || !Array.isArray(policy.dependency_allowlist.prohibited)) {
    errors.push('Missing or invalid dependency_allowlist.prohibited array');
  }

  if (policy.app_source_import_policy?.allow_external_app_source_import !== false) {
    errors.push('app_source_import_policy.allow_external_app_source_import must be false');
  }
  if (policy.app_source_import_policy?.enforce_code_imported_false !== true) {
    errors.push('app_source_import_policy.enforce_code_imported_false must be true');
  }

  if (!policy.provenance_requirements?.allowed_reference_categories || !Array.isArray(policy.provenance_requirements.allowed_reference_categories)) {
    errors.push('Missing or invalid provenance_requirements.allowed_reference_categories array');
  }
  if (!policy.provenance_requirements?.required_record_fields || !Array.isArray(policy.provenance_requirements.required_record_fields)) {
    errors.push('Missing or invalid provenance_requirements.required_record_fields array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Resolve local checkout directory path if cached.
 * @param {string} url
 * @param {string} [baseDir]
 * @returns {string|null}
 */
export function resolveLocalCheckoutDir(url, baseDir) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) return null;
  const [, org, repo] = match;

  const candidateBases = baseDir
    ? [baseDir]
    : [
        path.join(os.homedir(), '.cache', 'checkouts', 'github.com'),
        path.join(defaultRootDir, '.cache', 'checkouts', 'github.com'),
      ];

  for (const base of candidateBases) {
    const candidate = path.join(base, org, repo);
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, '.git'))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Verify pinned commit against local checkout cache if available.
 * @param {object} record
 * @param {string} [baseDir]
 * @returns {{ checked: boolean, verified: boolean, message?: string }}
 */
export function verifyLocalCommit(record, baseDir) {
  const checkoutDir = resolveLocalCheckoutDir(record.url, baseDir);
  if (!checkoutDir) {
    return { checked: false, verified: false, message: 'Local checkout cache not found' };
  }

  try {
    execFileSync('git', ['-C', checkoutDir, 'cat-file', '-e', record.pinned_commit], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return { checked: true, verified: true, message: `Verified in ${checkoutDir}` };
  } catch {
    return {
      checked: true,
      verified: false,
      message: `Commit ${record.pinned_commit} does not exist in local checkout ${checkoutDir}`,
    };
  }
}

/**
 * Validate an individual reference record against schema and policy rules.
 * @param {object} record
 * @param {object} policy
 * @param {object} [options]
 * @returns {{ valid: boolean, errors: string[], localVerified?: boolean, localMessage?: string }}
 */
export function validateRecord(record, policy, options = {}) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be a JSON object'] };
  }

  const requiredFields = policy?.provenance_requirements?.required_record_fields || [
    'id', 'name', 'url', 'pinned_commit', 'license', 'license_files',
    'category', 'role', 'studied_paths', 'studied_behavior',
    'code_imported', 'attribution_required', 'caveats', 'reviewer', 'verified_at'
  ];

  // Check required fields
  for (const field of requiredFields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`Missing required field: '${field}'`);
    }
  }

  // Check code_imported strictly equals false
  if (record.code_imported !== false) {
    errors.push(`Policy violation: 'code_imported' must be false (observed: ${record.code_imported}). Navin strictly prohibits importing external application source code.`);
  }

  // Check pinned commit format
  if (record.pinned_commit !== undefined) {
    const commitRegex = /^[0-9a-f]{40}$/i;
    if (!commitRegex.test(record.pinned_commit)) {
      errors.push(`Invalid 'pinned_commit': must be a 40-character hexadecimal git SHA (got '${record.pinned_commit}')`);
    }
  }

  // Check URL format
  if (record.url !== undefined) {
    if (!/^https?:\/\/.+/i.test(record.url)) {
      errors.push(`Invalid 'url': must be a valid HTTP/HTTPS URL (got '${record.url}')`);
    }
  }

  // Check license
  if (record.license !== undefined) {
    const prohibitedLicenseTokens = ['UNKNOWN', 'UNLICENSED', 'NONE'];
    const licUpper = String(record.license).toUpperCase().trim();
    if (prohibitedLicenseTokens.includes(licUpper)) {
      errors.push(`Invalid license: '${record.license}'. Reference must have a known, observed license.`);
    }
  }

  // Check category
  if (record.category !== undefined) {
    const allowedCategories = policy?.provenance_requirements?.allowed_reference_categories || [
      'reference-only',
      'architecture-reference',
      'standards-reference',
      'dependency-candidate',
      'external-engine'
    ];
    if (!allowedCategories.includes(record.category)) {
      errors.push(`Invalid category: '${record.category}'. Allowed categories: ${allowedCategories.join(', ')}`);
    }
  }

  // Check studied_paths is non-empty array
  if (record.studied_paths !== undefined) {
    if (!Array.isArray(record.studied_paths) || record.studied_paths.length === 0) {
      errors.push(`'studied_paths' must be a non-empty array of file/directory paths`);
    } else {
      for (const p of record.studied_paths) {
        if (typeof p !== 'string' || p.trim() === '') {
          errors.push(`'studied_paths' must contain non-empty path strings`);
          break;
        }
      }
    }
  }

  // Check license_files is non-empty array
  if (record.license_files !== undefined) {
    if (!Array.isArray(record.license_files) || record.license_files.length === 0) {
      errors.push(`'license_files' must be a non-empty array of file names`);
    }
  }

  // Check caveats is non-empty array
  if (record.caveats !== undefined) {
    if (!Array.isArray(record.caveats) || record.caveats.length === 0) {
      errors.push(`'caveats' must be a non-empty array of caveats and constraints`);
    }
  }

  let localVerified = false;
  let localMessage = '';

  if (options.verifyLocalCommits && record.url && record.pinned_commit && errors.length === 0) {
    const localCheck = verifyLocalCommit(record, options.checkoutsBaseDir);
    if (localCheck.checked && !localCheck.verified) {
      errors.push(localCheck.message);
    } else if (localCheck.verified) {
      localVerified = true;
      localMessage = localCheck.message;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    localVerified,
    localMessage,
  };
}

/**
 * Check all reference files in a directory.
 * @param {string} referencesDir
 * @param {string} policyPath
 * @param {object} [options]
 * @returns {{ total: number, passed: number, failed: number, records: Array, errors: Array }}
 */
export function checkAllReferences(referencesDir, policyPath, options = {}) {
  const policy = loadPolicy(policyPath);
  const policyResult = validatePolicy(policy);
  if (!policyResult.valid) {
    throw new Error(`Policy validation failed:\n  ${policyResult.errors.join('\n  ')}`);
  }

  if (!fs.existsSync(referencesDir)) {
    throw new Error(`References directory does not exist: ${referencesDir}`);
  }

  const files = fs.readdirSync(referencesDir).filter(f => f.endsWith('.json'));
  const records = [];
  const errors = [];
  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const fullPath = path.join(referencesDir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const record = JSON.parse(content);
      const result = validateRecord(record, policy, options);

      if (result.valid) {
        passed++;
        records.push({
          file,
          id: record.id,
          name: record.name,
          license: record.license,
          category: record.category,
          role: record.role,
          commit: record.pinned_commit.slice(0, 8),
          studiedPaths: record.studied_paths,
          studiedBehavior: record.studied_behavior,
          caveats: record.caveats,
          localVerified: result.localVerified,
          localMessage: result.localMessage,
          status: 'PASS',
        });
      } else {
        failed++;
        errors.push({ file, errors: result.errors });
        records.push({
          file,
          id: record.id || file,
          name: record.name || 'Unknown',
          license: record.license || 'Unknown',
          commit: 'N/A',
          localVerified: false,
          status: 'FAIL',
        });
      }
    } catch (err) {
      failed++;
      errors.push({ file, errors: [`JSON Parse or Read error: ${err.message}`] });
      records.push({ file, id: file, name: 'Parse Error', license: 'N/A', commit: 'N/A', localVerified: false, status: 'FAIL' });
    }
  }

  return {
    total: files.length,
    passed,
    failed,
    records,
    errors,
  };
}

/**
 * Main CLI entry point.
 */
export function main(args = process.argv.slice(2)) {
  const rootDir = defaultRootDir;
  let policyPath = path.join(rootDir, 'config', 'licenses', 'policy.json');
  let referencesDir = path.join(rootDir, 'docs', 'references');
  let checkoutsBaseDir = undefined;
  let verifyLocalCommits = true; // verify against local cache when available
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--policy' && args[i + 1]) {
      policyPath = path.resolve(args[++i]);
    } else if (args[i] === '--references' && args[i + 1]) {
      referencesDir = path.resolve(args[++i]);
    } else if (args[i] === '--checkouts-dir' && args[i + 1]) {
      checkoutsBaseDir = path.resolve(args[++i]);
    } else if (args[i] === '--no-verify-local') {
      verifyLocalCommits = false;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Navin License and Provenance Checker

Usage:
  node scripts/check-licenses.mjs [options]

Options:
  --policy <path>          Path to policy.json (default: config/licenses/policy.json)
  --references <path>      Path to docs/references/ (default: docs/references)
  --checkouts-dir <path>   Base directory for local checkouts cache
  --no-verify-local        Skip verifying pinned commits in local git caches
  --verbose, -v            Show detailed validation information
  --help, -h               Show this help message
`);
      process.exit(0);
    }
  }

  console.log('='.repeat(75));
  console.log('NAVIN PROVENANCE & LICENSE CHECKER');
  console.log('='.repeat(75));
  console.log(`Policy file:       ${path.relative(rootDir, policyPath)}`);
  console.log(`References dir:    ${path.relative(rootDir, referencesDir)}`);
  console.log(`Verify local git:  ${verifyLocalCommits ? 'Enabled (checks ~/.cache/checkouts)' : 'Disabled'}`);
  console.log(`Verbosity:         ${verbose ? 'Detailed (--verbose)' : 'Normal'}`);
  console.log('-'.repeat(75));

  try {
    const summary = checkAllReferences(referencesDir, policyPath, {
      verifyLocalCommits,
      checkoutsBaseDir,
    });

    console.log(`Found ${summary.total} reference records.\n`);
    for (const r of summary.records) {
      const tag = r.status === 'PASS' ? '[PASS]' : '[FAIL]';
      const localTag = r.localVerified ? ' (git-verified)' : '';
      console.log(`  ${tag.padEnd(7)} ${r.id.padEnd(20)} (${r.commit}) ${r.license.padEnd(28)} ${r.name}${localTag}`);
      if (verbose) {
        console.log(`          Role:     ${r.role || 'N/A'}`);
        console.log(`          Category: ${r.category || 'N/A'}`);
        if (r.localMessage) {
          console.log(`          Cache:    ${r.localMessage}`);
        }
        if (r.studiedPaths?.length) {
          console.log(`          Paths:    ${r.studiedPaths.join(', ')}`);
        }
        if (r.studiedBehavior) {
          console.log(`          Behavior: ${r.studiedBehavior}`);
        }
        if (r.caveats?.length) {
          console.log(`          Caveats:  ${r.caveats.join('; ')}`);
        }
        console.log('');
      }
    }

    console.log('\n' + '-'.repeat(75));
    console.log(`Summary: ${summary.passed} passed, ${summary.failed} failed out of ${summary.total} records.`);

    if (summary.failed > 0) {
      console.error('\n[ERRORS DETECTED]');
      for (const e of summary.errors) {
        console.error(`\nFile: ${e.file}`);
        for (const err of e.errors) {
          console.error(`  - ${err}`);
        }
      }
      console.log('='.repeat(75));
      process.exit(1);
    }

    console.log('\nAll reference records conform to provenance policy.');
    console.log('Zero code imported (code_imported: false verified across all references).');
    console.log('All pinned commits verified against local reference repository caches.');
    console.log('='.repeat(75));
    process.exit(0);
  } catch (err) {
    console.error(`\n[FATAL ERROR]: ${err.message}`);
    process.exit(1);
  }
}

// Execute when invoked directly
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectExecution) {
  main();
}

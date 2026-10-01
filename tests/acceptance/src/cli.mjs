import path from 'node:path'
import { verifyBundle, writeBundle } from './bundle.mjs'
import { EVIDENCE_CLASSES } from './classes.mjs'
import { createDefaultRegistry } from './executors.mjs'
import { DEFAULT_PRODUCTION_DENY, createGuard } from './guard.mjs'
import { loadManifest, validateManifest } from './manifest.mjs'
import { createRedactor, redactionRules } from './redaction.mjs'
import { runManifest } from './runner.mjs'
import { ALL_STATUSES, exitCodeFor, STATUS } from './status.mjs'

const HELP = `Navin acceptance harness (W05)

Usage:
  navin-acceptance run --manifest <path> [--out <dir>] [--allow <csv>] [--secret <value>...] [--json]
  navin-acceptance validate --manifest <path> [--json]
  navin-acceptance verify <bundleDir> [--json]
  navin-acceptance list-executors [--json]
  navin-acceptance rules [--json]
  navin-acceptance help

Statuses: ${ALL_STATUSES.join(', ')} (exit codes 0/1/2/3).
Production endpoints in deny-list are always rejected: ${DEFAULT_PRODUCTION_DENY.join(', ')}.`

export function parseArgs(argv) {
  const options = { _: [], secrets: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      options._.push(token)
      continue
    }
    const [flag, inline] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, undefined]
    const key = flag.slice(2)
    if (key === 'json' || key === 'quiet') {
      options[key] = true
      continue
    }
    const value = inline ?? argv[index + 1]
    if (inline === undefined) {
      index += 1
    }
    if (key === 'secret') {
      options.secrets.push(value)
    } else {
      options[key] = value
    }
  }
  return options
}

function print(value, { json }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(`${value}\n`)
  }
}

export async function main(argv = []) {
  const [command = 'help', ...rest] = argv
  const options = parseArgs(rest)

  if (command === 'help' || options.help) {
    print(HELP, options)
    return 0
  }

  if (command === 'rules') {
    print(
      JSON.stringify(
        { redactionRules: redactionRules(), evidenceClasses: EVIDENCE_CLASSES },
        null,
        2,
      ),
      options,
    )
    return 0
  }

  if (command === 'list-executors') {
    const registry = createDefaultRegistry()
    print(JSON.stringify({ executors: registry.list() }, null, 2), options)
    return 0
  }

  if (command === 'validate') {
    const manifestPath = options.manifest
    if (!manifestPath) {
      process.stderr.write('validate requires --manifest <path>\n')
      return 4
    }
    const manifest = loadManifest(manifestPath)
    const guard = createGuard({ allow: manifest.allow ?? [] })
    const registry = createDefaultRegistry()
    const result = validateManifest(manifest, { guard, registry })
    if (options.json) {
      print(JSON.stringify(result, null, 2), options)
    } else if (result.valid) {
      print(`VALID ${manifest.entries.length} entr(ies) in ${manifestPath}`, options)
    } else {
      process.stderr.write(`INVALID ${manifestPath}\n`)
      for (const error of result.errors) {
        process.stderr.write(`  - ${error.path}: ${error.message}\n`)
      }
    }
    return result.valid ? 0 : 1
  }

  if (command === 'verify') {
    const bundleDir = options._[0] ?? options.dir
    if (!bundleDir) {
      process.stderr.write('verify requires <bundleDir>\n')
      return 4
    }
    const result = verifyBundle(bundleDir)
    if (options.json) {
      print(JSON.stringify(result, null, 2), options)
    } else if (result.ok) {
      print(`OK verified ${result.checked} hashed artifact(s) in ${bundleDir}`, options)
    } else {
      process.stderr.write(`FAILED bundle verification for ${bundleDir}\n`)
      for (const error of result.errors) {
        process.stderr.write(`  - ${error.type}: ${JSON.stringify(error)}\n`)
      }
    }
    return result.ok ? 0 : 1
  }

  if (command === 'run') {
    const manifestPath = options.manifest
    if (!manifestPath) {
      process.stderr.write('run requires --manifest <path>\n')
      return 4
    }
    const manifest = loadManifest(manifestPath)
    const allow = options.allow
      ? String(options.allow)
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : (manifest.allow ?? [])
    const guard = createGuard({ allow })
    const redactor = createRedactor({ secrets: options.secrets })
    const registry = createDefaultRegistry()
    const run = await runManifest(manifest, {
      registry,
      guard,
      redactor,
      cwd: process.cwd(),
      logger: options.quiet
        ? () => {}
        : (event) =>
            process.stderr.write(
              `  [${event.status}] ${event.id}${event.detail ? ` - ${event.detail}` : ''}\n`,
            ),
    })
    const outDir = path.resolve(options.out ?? 'out')
    const bundle = writeBundle(run, manifest, { outDir })
    const verification = verifyBundle(bundle.bundleDir)

    const summary = {
      runId: run.runId,
      status: run.status,
      totals: run.totals,
      manifestHash: run.manifestHash,
      bundleDir: bundle.bundleDir,
      indexSha256: bundle.indexSha256,
      verified: verification.ok,
      verificationErrors: verification.errors,
    }

    if (options.json) {
      print(JSON.stringify({ ...summary, run }, null, 2), options)
    } else {
      process.stdout.write(`run ${run.runId} -> ${run.status}\n`)
      process.stdout.write(
        `  totals: PASS=${run.totals.PASS} FAIL=${run.totals.FAIL} BLOCKED=${run.totals.BLOCKED} NOT_RUN=${run.totals.NOT_RUN}\n`,
      )
      process.stdout.write(`  bundle: ${bundle.bundleDir}\n`)
      process.stdout.write(`  index.sha256: ${bundle.indexSha256}\n`)
      process.stdout.write(`  verification: ${verification.ok ? 'ok' : 'FAILED'}\n`)
    }

    if (!verification.ok) {
      return exitCodeFor(STATUS.FAIL)
    }
    return exitCodeFor(run.status)
  }

  process.stderr.write(`unknown command: ${command}\n${HELP}\n`)
  return 4
}

import { spawn } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { canSatisfy } from './classes.mjs'
import { PreconditionError } from './errors.mjs'
import { candidateTokens, createGuard } from './guard.mjs'
import { buildIndex, sha256File, verifyIndex } from './hashes.mjs'
import { nowIso } from './ids.mjs'
import {
  browserReceipt,
  commandReceipt,
  desktopReceipt,
  externalReceipt,
  protocolReceipt,
} from './receipts.mjs'
import { STATUS } from './status.mjs'

const NO_TARGET = Object.freeze({ required: false, param: null })

// Declares, per executor, whether a real network target is required and which
// params key carries it. The manifest validator and runner use this to require
// and guard the *effective* target rather than trusting entry.target alone.
const EXECUTOR_TARGETS = Object.freeze({
  'net.tcp-reachability': Object.freeze({ required: true, param: 'host' }),
  'protocol.smtp-banner': Object.freeze({ required: true, param: 'host' }),
  'protocol.imap-capability': Object.freeze({ required: true, param: 'host' }),
  'browser.command': Object.freeze({ required: true, param: 'url' }),
  'external.dns': Object.freeze({ required: true, param: 'domain' }),
  'external.deliverability': Object.freeze({ required: true, param: 'domain' }),
})

const VERSION_PROBES = Object.freeze({
  node: Object.freeze({ command: process.execPath, args: ['--version'] }),
  npm: Object.freeze({ command: 'npm', args: ['--version'] }),
  pnpm: Object.freeze({ command: 'pnpm', args: ['--version'] }),
  git: Object.freeze({ command: 'git', args: ['--version'] }),
  docker: Object.freeze({ command: 'docker', args: ['--version'] }),
  openssl: Object.freeze({ command: 'openssl', args: ['version'] }),
})

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EACCES',
  'ECONNRESET',
])

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function textOf(chunk) {
  return chunk.toString('utf8')
}

function unitReceipt({ checkId, output, status, correlationId: cid, detail, redactor }) {
  const startedAt = nowIso()
  return commandReceipt(
    {
      argv: ['self-check', checkId],
      exitCode: status === STATUS.PASS ? 0 : 1,
      stdout: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      startedAt,
      finishedAt: nowIso(),
      status,
      correlationId: cid,
      evidenceClass: 'unit',
      detail: detail ?? null,
    },
    { redactor },
  )
}

/**
 * Runs a command asynchronously and reliably kills it on timeout or abort.
 * Returns { status, signal, error, timedOut, stdout, stderr, startedAt, finishedAt }.
 */
function runCommand(argv, { timeoutMs = 15000, signal, cwd } = {}) {
  return new Promise((resolve) => {
    const startedAt = nowIso()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const forwardAbort = () => controller.abort()

    let stdout = ''
    let stderr = ''
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      if (signal) {
        signal.removeEventListener('abort', forwardAbort)
      }
    }
    const timeoutError = () =>
      Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })
    const done = (extra) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve({
        status: extra.status ?? null,
        signal: extra.signal ?? null,
        error: extra.error ?? null,
        timedOut,
        stdout,
        stderr,
        startedAt,
        finishedAt: nowIso(),
      })
    }

    if (signal) {
      if (signal.aborted) {
        done({ error: timeoutError() })
        return
      }
      signal.addEventListener('abort', forwardAbort, { once: true })
    }

    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        windowsHide: true,
        signal: controller.signal,
        killSignal: 'SIGKILL',
      })
    } catch (error) {
      done({ error })
      return
    }

    child.stdout?.on('data', (chunk) => {
      stdout += textOf(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += textOf(chunk)
    })
    child.on('error', (error) => {
      done({ error: timedOut ? timeoutError() : error })
    })
    child.on('close', (code, sig) => {
      done({ status: code, signal: sig, error: timedOut ? timeoutError() : null })
    })
  })
}

function commandDetail(result, timeoutMs) {
  if (result.timedOut) {
    return `command timed out after ${timeoutMs}ms`
  }
  if (result.error) {
    return String(result.error.message)
  }
  return `exit ${result.status ?? 'n/a'}`
}

function commandStatus(result) {
  return result.error || result.status !== 0 ? STATUS.FAIL : STATUS.PASS
}

function resolveVersionProbe(params = {}) {
  if (Array.isArray(params.argv) || Array.isArray(params.command)) {
    throw new PreconditionError(
      'command.version only runs allow-listed version probes, not arbitrary commands',
    )
  }
  const name = typeof params.probe === 'string' && params.probe ? params.probe : 'node'
  const probe = VERSION_PROBES[name]
  if (!probe) {
    throw new PreconditionError(`unsupported version probe: ${String(name)}`)
  }
  return { name, argv: [probe.command, ...probe.args] }
}

/**
 * Opens a socket dialogue. Aborting the signal (or the internal timeout)
 * destroys the socket so no work is left running.
 */
function talk({ host, port, steps = [], idleMs = 300, timeoutMs = 6000, signal }) {
  return new Promise((resolve) => {
    let transcript = ''
    let settled = false
    const socket = net.createConnection({ host, port })
    const hardTimer = setTimeout(
      () => finish({ outcome: 'timeout', error: `no completion within ${timeoutMs}ms` }),
      timeoutMs,
    )
    const onAbort = () => finish({ outcome: 'aborted', error: 'aborted' })

    function finish(result) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(hardTimer)
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
      socket.removeAllListeners()
      socket.destroy()
      resolve({ transcript, ...result })
    }

    if (signal) {
      if (signal.aborted) {
        finish({ outcome: 'aborted', error: 'aborted' })
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    socket.on('connect', async () => {
      try {
        for (const step of steps) {
          if (signal?.aborted) {
            finish({ outcome: 'aborted', error: 'aborted' })
            return
          }
          if (step.send) {
            socket.write(step.send)
          }
          if (step.waitMs) {
            await delay(step.waitMs)
          }
        }
        await delay(idleMs)
        finish({ outcome: 'ok' })
      } catch (error) {
        finish({ outcome: 'error', error: error.message })
      }
    })
    socket.on('data', (chunk) => {
      transcript += textOf(chunk)
    })
    socket.on('error', (error) => {
      finish({
        outcome: UNREACHABLE_CODES.has(error.code) ? 'unreachable' : 'error',
        error: `${error.code ?? 'ERR'}: ${error.message}`,
      })
    })
  })
}

function connectionStatus(outcome) {
  return outcome === 'unreachable' || outcome === 'timeout' ? STATUS.BLOCKED : STATUS.FAIL
}

/**
 * True when some argv element names the same network target (host/token or a
 * substring of the target). Used to fail closed on fake-PASS commands that exit
 * 0 without actually referencing the declared target.
 */
function argvReferencesTarget(argv, target) {
  const targetText = String(target ?? '')
    .trim()
    .toLowerCase()
  if (!targetText) {
    return false
  }
  const targetTokens = candidateTokens(targetText)
  for (const raw of argv) {
    const lower = String(raw ?? '').toLowerCase()
    for (const token of candidateTokens(lower)) {
      if (targetTokens.has(token)) {
        return true
      }
    }
    for (const token of targetTokens) {
      if (token.length >= 3 && lower.includes(token)) {
        return true
      }
    }
  }
  return false
}

/**
 * True when some argv element references the packaged artifact (exact path,
 * basename, `--flag=<artifact>` or a path substring). Fails closed on launches
 * that never touch the hashed artifact.
 */
function argvReferencesPath(argv, resolvedPath) {
  const normalized = String(resolvedPath ?? '')
    .split('\\')
    .join('/')
    .toLowerCase()
  if (!normalized) {
    return false
  }
  const base = normalized.split('/').pop()
  for (const raw of argv) {
    const arg = String(raw ?? '')
      .split('\\')
      .join('/')
      .toLowerCase()
    if (arg === normalized || arg.includes(normalized) || arg.endsWith(`=${normalized}`)) {
      return true
    }
    if (base && (arg === base || arg.endsWith(`/${base}`) || arg.endsWith(`=${base}`))) {
      return true
    }
  }
  return false
}

export function createDefaultRegistry() {
  const executors = new Map()

  function register(executor) {
    const target = executor.target ?? EXECUTOR_TARGETS[executor.name] ?? NO_TARGET
    executors.set(executor.name, { ...executor, target })
  }

  register({
    name: 'self.classes',
    evidenceClass: 'unit',
    description: 'Asserts the evidence-class ladder blocks weak evidence claiming strong outcomes.',
    async run(ctx) {
      const checks = [
        ['unit cannot satisfy external', canSatisfy('unit', 'external') === false],
        ['unit cannot satisfy desktop', canSatisfy('unit', 'desktop') === false],
        ['browser cannot satisfy desktop', canSatisfy('browser', 'desktop') === false],
        ['browser cannot satisfy external', canSatisfy('browser', 'external') === false],
        ['external satisfies unit', canSatisfy('external', 'unit') === true],
        ['desktop satisfies browser', canSatisfy('desktop', 'browser') === true],
      ]
      const failures = checks.filter(([, ok]) => !ok).map(([name]) => name)
      const status = failures.length > 0 ? STATUS.FAIL : STATUS.PASS
      const detail =
        failures.length > 0
          ? `failed checks: ${failures.join('; ')}`
          : 'evidence class ladder enforced'
      return {
        status,
        receipts: [
          unitReceipt({
            checkId: 'evidence-classes',
            output: { checks: checks.map(([name, ok]) => ({ check: name, ok })) },
            status,
            correlationId: ctx.correlationId,
            detail,
            redactor: ctx.redactor,
          }),
        ],
        detail,
      }
    },
  })

  register({
    name: 'self.redaction',
    evidenceClass: 'unit',
    description: 'Asserts secrets are removed from captured text before it can be stored.',
    async run(ctx) {
      const sample = [
        'STALWART_TOKEN=abc123SECRETvalue',
        'Authorization: Basic dXNlcjpwYXNz',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk',
        '{"password":"my secret, with; stuff","client_secret":"cs_abcdef123456"}',
        'password: "p@ss word, with; stuff"',
        'https://svcuser:s3cr3t-pw@example.test/inbox',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      ].join('\n')
      const secrets = [
        'abc123SECRETvalue',
        'dXNlcjpwYXNz',
        'my secret, with; stuff',
        'p@ss word, with; stuff',
        'cs_abcdef123456',
        's3cr3t-pw',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      ]
      const { text, matches } = ctx.redactor.redactText(sample)
      const leaked = secrets.filter((secret) => text.includes(secret))
      const status = leaked.length > 0 ? STATUS.FAIL : STATUS.PASS
      const detail =
        leaked.length > 0
          ? `${leaked.length} sample secret(s) survived redaction`
          : 'all sample secrets redacted'
      return {
        status,
        receipts: [
          unitReceipt({
            checkId: 'redaction',
            output: { rulesApplied: matches, redactedSample: text },
            status,
            correlationId: ctx.correlationId,
            detail,
            redactor: ctx.redactor,
          }),
        ],
        detail,
      }
    },
  })

  register({
    name: 'self.hashes',
    evidenceClass: 'unit',
    description: 'Asserts the SHA-256 index verifies clean files and detects tampering.',
    async run(ctx) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navin-hash-'))
      try {
        fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha')
        fs.writeFileSync(path.join(dir, 'b.txt'), 'beta')
        const index = buildIndex(dir, ['a.txt', 'b.txt'])
        const clean = verifyIndex(dir, index)
        fs.appendFileSync(path.join(dir, 'a.txt'), '-tampered')
        const tampered = verifyIndex(dir, index)
        const tamperDetected =
          !tampered.ok && tampered.errors.some((error) => error.type === 'hash-mismatch')
        const status = clean.ok && tamperDetected ? STATUS.PASS : STATUS.FAIL
        const output = {
          cleanOk: clean.ok,
          tamperDetected,
          indexSha256: index.indexSha256,
          entries: index.entries.map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
        }
        const detail =
          status === STATUS.PASS
            ? 'index verified and tamper detected'
            : 'index verification behaved unexpectedly'
        return {
          status,
          receipts: [
            unitReceipt({
              checkId: 'sha256-index',
              output,
              status,
              correlationId: ctx.correlationId,
              detail,
              redactor: ctx.redactor,
            }),
          ],
          detail,
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  })

  register({
    name: 'self.guard',
    evidenceClass: 'unit',
    description:
      'Asserts production endpoints are rejected and only local/disposable targets pass.',
    async run(ctx) {
      const localGuard = createGuard()
      const rejected = [
        'mail.production.example.invalid',
        'webmail.production.example.invalid',
        'production.example.invalid',
        'alice@production.example.invalid',
        'owner@example.invalid',
      ]
      const accepted = [
        'localhost',
        '127.0.0.1',
        'thing.test',
        'app.localhost',
        '203.0.113.10',
        'example.com',
      ]
      const checks = [
        ...rejected.map((target) => ({
          target,
          expect: false,
          actual: localGuard.checkTarget(target).allowed,
        })),
        ...accepted.map((target) => ({
          target,
          expect: true,
          actual: localGuard.checkTarget(target).allowed,
        })),
        {
          target: 'random-public-host.net',
          expect: false,
          actual: localGuard.checkTarget('random-public-host.net').allowed,
        },
        {
          target: 'explicit allow cannot permit a deny-listed production endpoint',
          expect: false,
          actual: createGuard({ allow: ['mail.production.example.invalid'] }).checkTarget(
            'mail.production.example.invalid',
          ).allowed,
        },
        {
          target: 'non-local target is denied without an allow-list entry',
          expect: false,
          actual: localGuard.checkTarget('external-vm.example.net').allowed,
        },
        {
          target: 'explicit allow-list entry permits a disposable external target',
          expect: true,
          actual: createGuard({ allow: ['external-vm.example.net'] }).checkTarget(
            'external-vm.example.net',
          ).allowed,
        },
      ]
      const failures = checks.filter((check) => check.actual !== check.expect)
      const status = failures.length > 0 ? STATUS.FAIL : STATUS.PASS
      const output = {
        checks: checks.map((check) => ({
          target: check.target,
          expected: check.expect,
          allowed: check.actual,
        })),
      }
      const detail =
        failures.length > 0
          ? `${failures.length} guard check(s) failed`
          : 'production deny guard enforced'
      return {
        status,
        receipts: [
          unitReceipt({
            checkId: 'production-guard',
            output,
            status,
            correlationId: ctx.correlationId,
            detail,
            redactor: ctx.redactor,
          }),
        ],
        detail,
      }
    },
  })

  register({
    name: 'command.version',
    evidenceClass: 'integration',
    description:
      'Runs only an allow-listed version probe command and captures a redacted command receipt.',
    async run(ctx) {
      const { argv } = resolveVersionProbe(ctx.params)
      const guardResult = ctx.guard.checkCommand(argv)
      if (!guardResult.allowed) {
        throw new PreconditionError(guardResult.reason)
      }
      const timeoutMs = ctx.timeoutMs ?? 15000
      const result = await runCommand(argv, { timeoutMs, signal: ctx.signal, cwd: ctx.cwd })
      if (result.error?.code === 'ENOENT') {
        throw new PreconditionError(`command not found: ${argv[0]}`)
      }
      const status = commandStatus(result)
      const receipt = commandReceipt(
        {
          argv,
          cwd: ctx.cwd ? path.relative(process.cwd(), ctx.cwd) || '.' : null,
          exitCode: result.status ?? null,
          signal: result.signal ?? null,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status,
          correlationId: ctx.correlationId,
          target: ctx.target,
          detail: result.timedOut
            ? `timed out after ${timeoutMs}ms`
            : result.error
              ? String(result.error.message)
              : null,
        },
        { redactor: ctx.redactor },
      )
      const detail =
        status === STATUS.PASS
          ? `exit 0: ${(result.stdout ?? '').trim()}`
          : commandDetail(result, timeoutMs)
      return { status, receipts: [receipt], detail }
    },
  })

  register({
    name: 'net.tcp-reachability',
    evidenceClass: 'integration',
    description:
      'Opens a real TCP connection to a disposable target and records transport evidence.',
    async run(ctx) {
      const host = ctx.target ?? ctx.params.host
      const port = ctx.params.port
      if (!host || !port) {
        throw new PreconditionError('tcp reachability requires a target host and params.port')
      }
      ctx.guard.assertTarget(host)
      const result = await talk({
        host,
        port,
        steps: [{ waitMs: 50 }],
        idleMs: 50,
        timeoutMs: ctx.params.timeoutMs ?? 5000,
        signal: ctx.signal,
      })
      const endpoint = `${host}:${port}`
      if (result.outcome === 'ok') {
        const receipt = protocolReceipt(
          {
            protocol: 'tcp',
            transport: 'tcp',
            endpoint,
            connected: true,
            transcript: `connected tcp ${endpoint}\n`,
            startedAt: nowIso(),
            finishedAt: nowIso(),
            status: STATUS.PASS,
            correlationId: ctx.correlationId,
            evidenceClass: 'integration',
            target: host,
          },
          { redactor: ctx.redactor },
        )
        return { status: STATUS.PASS, receipts: [receipt], detail: `tcp reachable ${endpoint}` }
      }
      const status = connectionStatus(result.outcome)
      const receipt = protocolReceipt(
        {
          protocol: 'tcp',
          transport: 'tcp',
          endpoint,
          connected: false,
          transcript: result.transcript ?? '',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          status,
          correlationId: ctx.correlationId,
          evidenceClass: 'integration',
          target: host,
          detail: result.error ?? null,
        },
        { redactor: ctx.redactor },
      )
      return {
        status,
        receipts: [receipt],
        detail: result.error ?? `tcp not reachable ${endpoint}`,
      }
    },
  })

  register({
    name: 'protocol.smtp-banner',
    evidenceClass: 'protocol',
    description: 'Reads a real SMTP banner and EHLO exchange from a disposable target.',
    async run(ctx) {
      const host = ctx.target ?? ctx.params.host
      const port = ctx.params.port ?? 25
      if (!host) {
        throw new PreconditionError('smtp protocol check requires a target host')
      }
      ctx.guard.assertTarget(host)
      const result = await talk({
        host,
        port,
        steps: [{ waitMs: 250 }, { send: 'EHLO navin-acceptance.local\r\n' }, { waitMs: 400 }],
        idleMs: 200,
        timeoutMs: ctx.params.timeoutMs ?? 8000,
        signal: ctx.signal,
      })
      const endpoint = `${host}:${port}`
      const connected = result.outcome === 'ok'
      const bannerOk = /^220[\s-]/.test(result.transcript.trimStart())
      const ehloOk = /^250[\s-]/m.test(result.transcript)
      const status = connected
        ? bannerOk && ehloOk
          ? STATUS.PASS
          : STATUS.FAIL
        : connectionStatus(result.outcome)
      const receipt = protocolReceipt(
        {
          protocol: 'smtp',
          transport: 'tcp',
          endpoint,
          connected,
          transcript: result.transcript ?? '',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          status,
          correlationId: ctx.correlationId,
          target: host,
          detail: result.error ?? null,
        },
        { redactor: ctx.redactor },
      )
      const detail =
        status === STATUS.PASS
          ? `SMTP banner and EHLO accepted at ${endpoint}`
          : connected
            ? 'SMTP banner/EHLO did not match expected 220/250 responses'
            : (result.error ?? `smtp not reachable ${endpoint}`)
      return { status, receipts: [receipt], detail }
    },
  })

  register({
    name: 'protocol.imap-capability',
    evidenceClass: 'protocol',
    description: 'Reads a real IMAP greeting and CAPABILITY exchange from a disposable target.',
    async run(ctx) {
      const host = ctx.target ?? ctx.params.host
      const port = ctx.params.port ?? 143
      if (!host) {
        throw new PreconditionError('imap protocol check requires a target host')
      }
      ctx.guard.assertTarget(host)
      const result = await talk({
        host,
        port,
        steps: [{ waitMs: 250 }, { send: 'a1 CAPABILITY\r\n' }, { waitMs: 500 }],
        idleMs: 200,
        timeoutMs: ctx.params.timeoutMs ?? 8000,
        signal: ctx.signal,
      })
      const endpoint = `${host}:${port}`
      const connected = result.outcome === 'ok'
      const greetingOk = /^\* OK/m.test(result.transcript)
      const capabilityOk = /a1 OK/i.test(result.transcript)
      const status = connected
        ? greetingOk && capabilityOk
          ? STATUS.PASS
          : STATUS.FAIL
        : connectionStatus(result.outcome)
      const receipt = protocolReceipt(
        {
          protocol: 'imap',
          transport: 'tcp',
          endpoint,
          connected,
          transcript: result.transcript ?? '',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          status,
          correlationId: ctx.correlationId,
          target: host,
          detail: result.error ?? null,
        },
        { redactor: ctx.redactor },
      )
      const detail =
        status === STATUS.PASS
          ? `IMAP greeting and CAPABILITY accepted at ${endpoint}`
          : connected
            ? 'IMAP greeting/CAPABILITY did not match expected responses'
            : (result.error ?? `imap not reachable ${endpoint}`)
      return { status, receipts: [receipt], detail }
    },
  })

  register({
    name: 'browser.command',
    evidenceClass: 'browser',
    description:
      'Runs a configured browser driver command against a disposable URL and records browser evidence.',
    async run(ctx) {
      const url = ctx.params.url
      if (!url) {
        throw new PreconditionError('browser check requires params.url')
      }
      ctx.guard.assertTarget(url)
      const command = ctx.params.command
      if (!Array.isArray(command) || command.length === 0) {
        throw new PreconditionError(
          'no browser driver configured for this environment (set params.command)',
        )
      }
      const argv = [...command, ...(Array.isArray(ctx.params.args) ? ctx.params.args : [])]
      const guardResult = ctx.guard.checkCommand(argv)
      if (!guardResult.allowed) {
        throw new PreconditionError(guardResult.reason)
      }
      if (!argvReferencesTarget(argv, url)) {
        throw new PreconditionError(
          `browser driver argv must reference the target url ${JSON.stringify(url)}`,
        )
      }
      const timeoutMs = ctx.timeoutMs ?? 120000
      const result = await runCommand(argv, { timeoutMs, signal: ctx.signal, cwd: ctx.cwd })
      const status = commandStatus(result)
      const receipt = browserReceipt(
        {
          url,
          browser: ctx.params.browser ?? null,
          driver: command[0],
          consoleErrors: ctx.params.consoleErrors ?? [],
          network: ctx.params.network ?? [],
          screenshots: ctx.params.screenshots ?? [],
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status,
          correlationId: ctx.correlationId,
          target: url,
          detail: result.error ? String(result.error.message) : null,
        },
        { redactor: ctx.redactor },
      )
      return {
        status,
        receipts: [receipt],
        detail:
          status === STATUS.PASS
            ? `browser driver exited 0 for ${url}`
            : commandDetail(result, timeoutMs),
      }
    },
  })

  register({
    name: 'desktop.package',
    evidenceClass: 'desktop',
    description:
      'Hashes and launches a packaged Desktop artifact; unproven packaging is reported BLOCKED.',
    async run(ctx) {
      const artifactPath = ctx.params.artifactPath
      if (!artifactPath) {
        throw new PreconditionError('desktop check requires params.artifactPath')
      }
      const resolved = path.resolve(artifactPath)
      if (!fs.existsSync(resolved)) {
        throw new PreconditionError(`packaged artifact not present: ${artifactPath}`)
      }
      const launch = ctx.params.launchCommand
      if (!Array.isArray(launch) || launch.length === 0) {
        throw new PreconditionError(
          'packaged artifact present but no launch command configured; packaged proof cannot be claimed',
        )
      }
      const guardResult = ctx.guard.checkCommand(launch)
      if (!guardResult.allowed) {
        throw new PreconditionError(guardResult.reason)
      }
      if (!argvReferencesPath(launch, resolved)) {
        throw new PreconditionError(
          `desktop launch command must reference the packaged artifact ${path.basename(resolved)}`,
        )
      }
      const timeoutMs = ctx.timeoutMs ?? 120000
      const result = await runCommand(launch, { timeoutMs, signal: ctx.signal, cwd: ctx.cwd })
      const status = commandStatus(result)
      const receipt = desktopReceipt(
        {
          packageType: ctx.params.packageType ?? (path.extname(resolved).replace('.', '') || null),
          artifactName: path.basename(resolved),
          artifactPath: resolved,
          artifactSha256: sha256File(resolved),
          appVersion: ctx.params.appVersion ?? null,
          platform: process.platform,
          launched: true,
          launchExitCode: result.status ?? null,
          launchLog: `${result.stdout ?? ''}${result.stderr ?? ''}`,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status,
          correlationId: ctx.correlationId,
          detail: result.error ? String(result.error.message) : null,
        },
        { redactor: ctx.redactor },
      )
      return {
        status,
        receipts: [receipt],
        detail:
          status === STATUS.PASS
            ? `packaged desktop artifact launched: ${path.basename(resolved)}`
            : commandDetail(result, timeoutMs),
      }
    },
  })

  register({
    name: 'external.dns',
    evidenceClass: 'external',
    description: 'Resolves real DNS records for an authorized disposable domain.',
    async run(ctx) {
      const domain = ctx.params.domain
      if (!domain || !String(domain).trim()) {
        throw new PreconditionError('no authorized external domain configured')
      }
      ctx.guard.assertTarget(domain)
      const startedAt = nowIso()
      const types =
        Array.isArray(ctx.params.types) && ctx.params.types.length > 0
          ? ctx.params.types
          : ['MX', 'TXT', 'A']
      const records = {}
      for (const type of types) {
        if (ctx.signal?.aborted) {
          break
        }
        try {
          records[type] = await dns.resolve(domain, type)
        } catch (error) {
          records[type] = { error: error.code ?? String(error.message) }
        }
      }
      const resolvedCount = types.filter((type) => Array.isArray(records[type])).length
      const status = resolvedCount > 0 ? STATUS.PASS : STATUS.FAIL
      const receipt = externalReceipt(
        {
          domain,
          records,
          resolvers: [dns.getServers?.() ?? []].flat(),
          sources: [`dns.resolve:${types.join(',')}`],
          startedAt,
          finishedAt: nowIso(),
          status,
          correlationId: ctx.correlationId,
          target: domain,
        },
        { redactor: ctx.redactor },
      )
      return {
        status,
        receipts: [receipt],
        detail:
          status === STATUS.PASS
            ? `resolved ${resolvedCount}/${types.length} record type(s) for ${domain}`
            : `no DNS records resolved for ${domain}`,
      }
    },
  })

  register({
    name: 'external.deliverability',
    evidenceClass: 'external',
    description: 'Runs an authorized external deliverability probe; requires explicit resources.',
    async run(ctx) {
      if (!Array.isArray(ctx.params.probe) || ctx.params.probe.length === 0) {
        throw new PreconditionError('no authorized external deliverability resources configured')
      }
      const domain = ctx.params.domain
      if (!domain || !String(domain).trim()) {
        throw new PreconditionError(
          'external deliverability requires an authorized domain in params.domain',
        )
      }
      ctx.guard.assertTarget(domain)
      const guardResult = ctx.guard.checkCommand(ctx.params.probe)
      if (!guardResult.allowed) {
        throw new PreconditionError(guardResult.reason)
      }
      if (!argvReferencesTarget(ctx.params.probe, domain)) {
        throw new PreconditionError(
          `external deliverability probe must reference the authorized domain ${JSON.stringify(domain)}`,
        )
      }
      const timeoutMs = ctx.timeoutMs ?? 120000
      const result = await runCommand(ctx.params.probe, {
        timeoutMs,
        signal: ctx.signal,
        cwd: ctx.cwd,
      })
      const status = commandStatus(result)
      const receipt = externalReceipt(
        {
          domain: ctx.params.domain ?? null,
          sources: [`probe:${ctx.params.probe[0]}`],
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          status,
          correlationId: ctx.correlationId,
          target: ctx.params.domain ?? null,
          detail: result.error ? String(result.error.message) : null,
        },
        { redactor: ctx.redactor },
      )
      return {
        status,
        receipts: [receipt],
        detail:
          status === STATUS.PASS
            ? 'external deliverability probe passed'
            : commandDetail(result, timeoutMs),
      }
    },
  })

  return {
    has: (name) => executors.has(name),
    get: (name) => executors.get(name),
    names: () => [...executors.keys()].sort(),
    list: () =>
      [...executors.values()]
        .map((executor) => ({
          name: executor.name,
          evidenceClass: executor.evidenceClass,
          description: executor.description,
          target: executor.target,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

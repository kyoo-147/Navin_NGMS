import { assertEvidenceClass } from './classes.mjs'
import { durationMs, correlationId, nowIso } from './ids.mjs'
import { sha256Hex, sha256Json } from './hashes.mjs'
import { summarizeRedactions } from './redaction.mjs'
import { assertStatus } from './status.mjs'

export const RECEIPT_SCHEMA_VERSION = 1

export const RECEIPT_KINDS = Object.freeze([
  'command',
  'protocol',
  'browser',
  'desktop',
  'external',
])

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

export function receiptHash(receipt) {
  const copy = { ...receipt }
  delete copy.receiptSha256
  return sha256Json(copy)
}

export function verifyReceiptHash(receipt) {
  return receiptHash(receipt) === receipt.receiptSha256
}

function redactText(redactor, value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return redactor ? redactor.redactText(text).text : text
}

export function sealReceipt(raw, { redactor } = {}) {
  assertEvidenceClass(raw.evidenceClass)
  assertStatus(raw.status)
  const redacted = redactor ? redactor.redactValue(raw) : { value: raw, matches: [] }
  const value = redacted.value
  const createdAt = value.createdAt ?? nowIso()
  const startedAt = value.startedAt ?? createdAt
  const finishedAt = value.finishedAt ?? nowIso()
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: value.receiptId ?? correlationId('receipt'),
    kind: value.kind,
    evidenceClass: value.evidenceClass,
    status: value.status,
    correlationId: value.correlationId ?? correlationId('receipt'),
    createdAt,
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
    target: value.target ?? null,
    detail: value.detail ?? null,
    redaction: {
      applied: (redacted.matches?.length ?? 0) > 0,
      rules: summarizeRedactions(redacted.matches),
    },
    payload: value.payload ?? {},
  }
  receipt.payloadSha256 = sha256Json(receipt.payload)
  receipt.receiptSha256 = receiptHash(receipt)
  return deepFreeze(receipt)
}

function buildReceipt(kind, defaultClass, input, options) {
  const source = input ?? {}
  const payload = source.payload ?? {}
  const evidenceClass = source.evidenceClass ?? defaultClass
  return sealReceipt(
    {
      kind,
      evidenceClass,
      status: source.status,
      receiptId: source.receiptId,
      correlationId: source.correlationId,
      createdAt: source.createdAt,
      startedAt: source.startedAt,
      finishedAt: source.finishedAt,
      target: source.target,
      detail: source.detail,
      payload,
    },
    { redactor: options?.redactor },
  )
}

export function commandReceipt(input = {}, options = {}) {
  const stdout = redactText(options.redactor, input.stdout ?? '')
  const stderr = redactText(options.redactor, input.stderr ?? '')
  return buildReceipt(
    'command',
    'integration',
    {
      ...input,
      payload: {
        argv: input.argv ?? [],
        cwd: input.cwd ?? null,
        exitCode: input.exitCode ?? null,
        signal: input.signal ?? null,
        stdout,
        stderr,
        stdoutSha256: sha256Hex(stdout),
        stderrSha256: sha256Hex(stderr),
      },
    },
    options,
  )
}

export function protocolReceipt(input = {}, options = {}) {
  const transcript = redactText(options.redactor, input.transcript ?? '')
  return buildReceipt(
    'protocol',
    'protocol',
    {
      ...input,
      payload: {
        protocol: input.protocol ?? 'unknown',
        transport: input.transport ?? 'tcp',
        endpoint: input.endpoint ?? null,
        connected: Boolean(input.connected),
        tls: input.tls ?? null,
        transcript,
        transcriptSha256: sha256Hex(transcript),
      },
    },
    options,
  )
}

export function browserReceipt(input = {}, options = {}) {
  const redactList = (values) => (values ?? []).map((entry) => redactText(options.redactor, entry))
  return buildReceipt(
    'browser',
    'browser',
    {
      ...input,
      payload: {
        url: input.url ?? null,
        browser: input.browser ?? null,
        driver: input.driver ?? null,
        consoleErrors: redactList(input.consoleErrors),
        network: redactList(input.network),
        screenshots: redactList(input.screenshots),
      },
    },
    options,
  )
}

export function desktopReceipt(input = {}, options = {}) {
  const launchLog = redactText(options.redactor, input.launchLog ?? '')
  return buildReceipt(
    'desktop',
    'desktop',
    {
      ...input,
      payload: {
        packageType: input.packageType ?? null,
        artifactName: input.artifactName ?? null,
        artifactPath: input.artifactPath ?? null,
        artifactSha256: input.artifactSha256 ?? null,
        appVersion: input.appVersion ?? null,
        platform: input.platform ?? process.platform,
        launched: Boolean(input.launched),
        launchExitCode: input.launchExitCode ?? null,
        launchLog,
        launchLogSha256: sha256Hex(launchLog),
      },
    },
    options,
  )
}

export function externalReceipt(input = {}, options = {}) {
  const redactList = (values) => (values ?? []).map((entry) => redactText(options.redactor, entry))
  return buildReceipt(
    'external',
    'external',
    {
      ...input,
      payload: {
        domain: input.domain ?? null,
        resolvers: input.resolvers ?? [],
        records: input.records ?? {},
        ptr: input.ptr ?? null,
        tls: input.tls ?? null,
        spf: input.spf ?? null,
        dkim: input.dkim ?? null,
        dmarc: input.dmarc ?? null,
        sources: redactList(input.sources),
      },
    },
    options,
  )
}

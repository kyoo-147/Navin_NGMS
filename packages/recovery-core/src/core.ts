import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  type KeyObject,
} from 'node:crypto'

import { RecoveryJournal } from './journal.js'
import type {
  BackupGenerationResult,
  BackupManifest,
  BackupRecord,
  KeyResolver,
  ManifestEntry,
  ObjectStorePort,
  RestoreOptions,
  RestorePreflight,
  RestoreResult,
  RetentionPolicy,
} from './types.js'

interface EncryptedEnvelope {
  algorithm: 'aes-256-gcm'
  keyReference: string
  iv: string
  authTag: string
  ciphertext: string
}

export interface BackupCoreOptions {
  store: ObjectStorePort
  keys: KeyResolver
  journal?: RecoveryJournal
}

export class RecoveryCore {
  private readonly journal: RecoveryJournal

  constructor(private readonly options: BackupCoreOptions) {
    this.journal = options.journal ?? new RecoveryJournal(':memory:')
  }

  async createGeneration(
    records: Iterable<BackupRecord> | AsyncIterable<BackupRecord>,
    keyReference: string,
    generationId = randomUUID(),
  ): Promise<BackupGenerationResult> {
    if (keyReference.trim() === '') throw new Error('A non-secret key reference is required')
    const key = await this.options.keys.resolve(keyReference)
    validateKey(key)
    const createdAt = new Date().toISOString()
    this.journal.ensureGeneration(generationId, keyReference, createdAt)
    if (this.journal.isComplete(generationId)) {
      const manifest = await this.readManifest(generationId)
      return {
        generationId,
        manifest,
        manifestKey: manifestKey(generationId),
        indexKey: indexKey(generationId),
        complete: true,
        uploaded: 0,
        reused: manifest.entries.length,
      }
    }

    const entries: ManifestEntry[] = []
    let uploaded = 0
    let reused = 0
    for await (const record of records) {
      validateRecord(record)
      const contentHash = sha256(record.content)
      const existingKey = this.journal.getUpload(generationId, contentHash)
      let objectKey: string
      if (existingKey !== undefined) {
        objectKey = existingKey
        reused += 1
      } else {
        const envelope = encrypt(record.content, keyReference, key)
        const bytes = encode(envelope)
        const envelopeHash = sha256(bytes)
        objectKey = objectKeyFor(envelopeHash)
        const result = await this.options.store.putImmutable(objectKey, bytes)
        if (result === 'created') uploaded += 1
        else reused += 1
        this.journal.markUploaded(generationId, contentHash, objectKey)
      }
      entries.push({
        id: record.id,
        kind: record.kind,
        contentHash,
        objectKey,
        plaintextBytes: record.content.byteLength,
        metadata: cloneJson(record.metadata),
      })
    }

    entries.sort((left, right) => left.id.localeCompare(right.id))
    const index = entries.reduce<Record<string, string>>((accumulator, entry) => {
      accumulator[entry.contentHash] = entry.objectKey
      return accumulator
    }, {})
    const indexBytes = encode(index)
    const indexHash = sha256(indexBytes)

    const manifestWithoutHash: Omit<BackupManifest, 'manifestHash'> = {
      schemaVersion: 1,
      generationId,
      createdAt,
      keyReference,
      algorithm: 'aes-256-gcm',
      entries,
      indexHash,
    }
    const manifestHash = sha256(encode(manifestWithoutHash))
    const manifest: BackupManifest = {
      ...manifestWithoutHash,
      manifestHash,
    }

    const encryptedIndex = encode(encrypt(indexBytes, keyReference, key))
    const encryptedManifest = encode(encrypt(encode(manifest), keyReference, key))

    await this.options.store.putImmutable(indexKey(generationId), encryptedIndex)
    await this.options.store.putImmutable(manifestKey(generationId), encryptedManifest)
    // Content-addressed manifest storage
    const manifestEnvelopeHash = sha256(encryptedManifest)
    await this.options.store.putImmutable(objectKeyFor(manifestEnvelopeHash), encryptedManifest)
    await this.options.store.putImmutable(
      completeKey(generationId),
      encode({ generationId, completedAt: new Date().toISOString() }),
    )
    this.journal.markComplete(generationId)
    return {
      generationId,
      manifest,
      manifestKey: manifestKey(generationId),
      indexKey: indexKey(generationId),
      complete: true,
      uploaded,
      reused,
    }
  }

  async readManifest(generationId: string): Promise<BackupManifest> {
    const rawEnvelope = await this.options.store.get(manifestKey(generationId))
    const envelope = decode(rawEnvelope) as EncryptedEnvelope
    const key = await this.options.keys.resolve(envelope.keyReference)
    validateKey(key)
    const decryptedBytes = decrypt(envelope, key)
    const manifest = JSON.parse(new TextDecoder().decode(decryptedBytes)) as BackupManifest
    if (manifest.generationId !== generationId || manifest.algorithm !== 'aes-256-gcm') {
      throw new Error('Invalid backup manifest')
    }
    if (manifest.manifestHash) {
      const { manifestHash: expectedHash, ...rest } = manifest
      const actualHash = sha256(encode(rest))
      if (actualHash !== expectedHash) {
        throw new Error('Manifest content hash mismatch')
      }
    }
    return manifest
  }

  async restore(generationId: string, options: RestoreOptions): Promise<RestoreResult> {
    if (options.target.targetId.trim() === '' || options.target.isolation !== 'isolated') {
      throw new Error('Restore refused: target must be explicitly isolated')
    }
    const manifest = await this.readManifest(generationId)
    const existing = await options.target.preflight()
    const preflight: RestorePreflight = {
      targetId: options.target.targetId,
      isolated: options.target.isolation === 'isolated',
      existingRecords: existing.existingRecords,
      entries: manifest.entries.length,
      collisionPolicy: options.collisionPolicy,
    }

    if (options.mode === 'preflight') {
      return {
        generationId,
        mode: options.mode,
        targetId: options.target.targetId,
        preflight,
        restored: 0,
        skipped: 0,
        replaced: 0,
        verifiedHashes: 0,
        failures: [],
        backupSuccess: false,
      }
    }

    const key = await this.options.keys.resolve(manifest.keyReference)
    validateKey(key)

    const rawIndex = await this.options.store.get(indexKey(generationId))
    const indexBytes = decrypt(decode(rawIndex) as EncryptedEnvelope, key)
    if (sha256(indexBytes) !== manifest.indexHash) {
      throw new Error('Backup index hash mismatch')
    }
    const index = JSON.parse(new TextDecoder().decode(indexBytes)) as Record<string, string>

    if (options.mode === 'dry-run') {
      const result: RestoreResult = {
        generationId,
        mode: options.mode,
        targetId: options.target.targetId,
        preflight,
        restored: 0,
        skipped: 0,
        replaced: 0,
        verifiedHashes: 0,
        failures: [],
        backupSuccess: false,
      }
      for (const entry of manifest.entries) {
        try {
          if (index[entry.contentHash] !== entry.objectKey) {
            throw new Error('Manifest/index object mapping mismatch')
          }
          const rawObject = await this.options.store.get(entry.objectKey)
          const envelope = decode(rawObject) as EncryptedEnvelope
          const content = decrypt(envelope, key)
          if (
            sha256(content) !== entry.contentHash ||
            content.byteLength !== entry.plaintextBytes
          ) {
            throw new Error('Content hash verification failed')
          }
          result.verifiedHashes += 1

          const exists = options.target.hasRecord ? await options.target.hasRecord(entry.id) : false
          if (exists) {
            if (options.collisionPolicy === 'fail') {
              result.failures.push({
                recordId: entry.id,
                code: 'COLLISION_DETECTED',
                message: `Record ${entry.id} already exists on target`,
              })
            } else if (options.collisionPolicy === 'skip') {
              result.skipped += 1
            } else if (options.collisionPolicy === 'replace') {
              result.replaced += 1
            }
          } else {
            result.restored += 1
          }
        } catch (error) {
          result.failures.push({
            recordId: entry.id,
            code: 'DRY_RUN_VERIFICATION_FAILED',
            message: errorMessage(error),
          })
        }
      }
      return result
    }

    // Mode is 'restore': Requires Tier-3 approval
    if (!isTier3Approval(options.approval)) {
      throw new Error('Restore refused: Tier-3 approval is required for restore mutation')
    }

    const result: RestoreResult = {
      generationId,
      mode: options.mode,
      targetId: options.target.targetId,
      preflight,
      restored: 0,
      skipped: 0,
      replaced: 0,
      verifiedHashes: 0,
      failures: [],
      backupSuccess: false,
    }
    const sampleSize = Math.max(1, Math.trunc(options.sampleSize ?? 3))
    for (const entry of manifest.entries) {
      try {
        if (index[entry.contentHash] !== entry.objectKey) {
          throw new Error('Manifest/index object mapping mismatch')
        }
        const rawObject = await this.options.store.get(entry.objectKey)
        const envelope = decode(rawObject) as EncryptedEnvelope
        const content = decrypt(envelope, key)
        if (sha256(content) !== entry.contentHash || content.byteLength !== entry.plaintextBytes) {
          throw new Error('Content hash verification failed')
        }
        result.verifiedHashes += 1
        const writeResult = await options.target.writeRecord(
          { id: entry.id, kind: entry.kind, content, metadata: cloneJson(entry.metadata) },
          options.collisionPolicy,
        )
        if (writeResult === 'created') result.restored += 1
        if (writeResult === 'replaced') result.replaced += 1
        if (writeResult === 'skipped') result.skipped += 1
      } catch (error) {
        result.failures.push({
          recordId: entry.id,
          code: 'RESTORE_ITEM_FAILED',
          message: errorMessage(error),
        })
      }
    }
    const verification = await options.target.verify()
    result.verification = verification
    result.backupSuccess =
      result.failures.length === 0 &&
      result.verifiedHashes === manifest.entries.length &&
      verification.authenticated &&
      verification.readable &&
      verification.searchable &&
      result.verifiedHashes >= Math.min(sampleSize, manifest.entries.length)
    return result
  }

  async applyRetention(policy: RetentionPolicy): Promise<string[]> {
    if (!Number.isInteger(policy.keepGenerations) || policy.keepGenerations < 1) {
      throw new Error('keepGenerations must be a positive integer')
    }
    const complete = (await this.options.store.list('generations/'))
      .filter((key) => key.endsWith('/complete'))
      .map((key) => key.split('/')[1])
      .filter((id): id is string => id !== undefined)
    const generations = await Promise.all(
      complete.map(async (id) => ({ id, manifest: await this.readManifest(id) })),
    )
    generations.sort((left, right) =>
      right.manifest.createdAt.localeCompare(left.manifest.createdAt),
    )
    const removed: string[] = []
    for (const generation of generations.slice(policy.keepGenerations)) {
      if (this.options.store.delete === undefined) continue
      await Promise.all([
        this.options.store.delete(manifestKey(generation.id)),
        this.options.store.delete(indexKey(generation.id)),
        this.options.store.delete(completeKey(generation.id)),
      ])
      removed.push(generation.id)
    }
    // Prune unreferenced objects after removing generations
    await this.pruneOrphanedObjects()
    return removed
  }

  async cleanupPartial(generationId?: string): Promise<string[]> {
    if (this.options.store.delete === undefined) return []

    if (generationId !== undefined) {
      const isDone = this.journal.isComplete(generationId)
      if (isDone) return []
      await Promise.all([
        this.options.store.delete(manifestKey(generationId)),
        this.options.store.delete(indexKey(generationId)),
        this.options.store.delete(completeKey(generationId)),
      ])
      await this.pruneOrphanedObjects()
      return [generationId]
    }

    const allGenerationFiles = await this.options.store.list('generations/')
    const allGenIds = new Set(
      allGenerationFiles
        .map((key) => key.split('/')[1])
        .filter((id): id is string => id !== undefined),
    )
    const cleaned: string[] = []

    for (const id of allGenIds) {
      const hasComplete = allGenerationFiles.includes(completeKey(id))
      if (!hasComplete && !this.journal.isComplete(id)) {
        await Promise.all([
          this.options.store.delete(manifestKey(id)),
          this.options.store.delete(indexKey(id)),
          this.options.store.delete(completeKey(id)),
        ])
        cleaned.push(id)
      }
    }
    await this.pruneOrphanedObjects()
    return cleaned
  }

  async pruneOrphanedObjects(): Promise<string[]> {
    if (this.options.store.delete === undefined) return []

    const completeFiles = (await this.options.store.list('generations/')).filter((key) =>
      key.endsWith('/complete'),
    )
    const completeGenIds = completeFiles
      .map((key) => key.split('/')[1])
      .filter((id): id is string => id !== undefined)

    const referencedObjects = new Set<string>()
    for (const genId of completeGenIds) {
      try {
        const manifest = await this.readManifest(genId)
        for (const entry of manifest.entries) {
          referencedObjects.add(entry.objectKey)
        }
        try {
          const rawManifest = await this.options.store.get(manifestKey(genId))
          const manifestEnvelopeHash = sha256(rawManifest)
          referencedObjects.add(objectKeyFor(manifestEnvelopeHash))
        } catch {
          // ignore
        }
      } catch {
        // If manifest cannot be read, preserve files safely
      }
    }

    const existingObjects = await this.options.store.list('objects/')
    const deleted: string[] = []
    for (const objKey of existingObjects) {
      if (!referencedObjects.has(objKey)) {
        await this.options.store.delete(objKey)
        deleted.push(objKey)
      }
    }
    return deleted
  }
}

export function objectKeyFor(hash: string): string {
  return `objects/sha256/${hash}`
}

export function manifestKey(generationId: string): string {
  return `generations/${generationId}/manifest.enc`
}

export function indexKey(generationId: string): string {
  return `generations/${generationId}/index.enc`
}

export function completeKey(generationId: string): string {
  return `generations/${generationId}/complete`
}

function encrypt(
  content: Uint8Array,
  keyReference: string,
  key: Uint8Array | KeyObject,
): EncryptedEnvelope {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()])
  return {
    algorithm: 'aes-256-gcm',
    keyReference,
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }
}

function decrypt(envelope: EncryptedEnvelope, key: Uint8Array | KeyObject): Uint8Array {
  if (envelope.algorithm !== 'aes-256-gcm')
    throw new Error('Unsupported backup encryption algorithm')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'))
    return new Uint8Array(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]),
    )
  } catch (error) {
    throw new Error(`Decryption failed (wrong key or tampered envelope): ${errorMessage(error)}`)
  }
}

function validateKey(key: Uint8Array | KeyObject): void {
  if (key instanceof Uint8Array && key.byteLength !== 32) {
    throw new Error('AES-256 backup keys must be 32 bytes')
  }
}

function validateRecord(record: BackupRecord): void {
  if (record.id.trim() === '') throw new Error('Backup record id is required')
  if (!(record.content instanceof Uint8Array))
    throw new Error(`Record ${record.id} content must be bytes`)
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function decode(value: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(value)) as unknown
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTier3Approval(value: RestoreOptions['approval']): boolean {
  return Boolean(value?.tier === 3 && value.approved === true && value.approvalId.trim() !== '')
}

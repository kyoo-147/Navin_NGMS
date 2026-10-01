import type { KeyObject } from 'node:crypto'

export type BackupRecordKind = 'raw-message' | 'attachment' | 'metadata' | 'thread' | 'account'
export type CollisionPolicy = 'fail' | 'skip' | 'replace'

export interface BackupRecord {
  id: string
  kind: BackupRecordKind
  content: Uint8Array
  metadata: Record<string, unknown>
}

export interface ObjectStorePort {
  putImmutable(key: string, value: Uint8Array): Promise<'created' | 'exists'>
  get(key: string): Promise<Uint8Array>
  list(prefix?: string): Promise<string[]>
  delete?(key: string): Promise<void>
}

export interface S3CompatibleObjectStorePort extends ObjectStorePort {
  readonly provider: 's3-compatible'
}

export interface KeyResolver {
  resolve(keyReference: string): Promise<Uint8Array | KeyObject>
}

export interface ManifestEntry {
  id: string
  kind: BackupRecordKind
  contentHash: string
  objectKey: string
  plaintextBytes: number
  metadata: Record<string, unknown>
}

export interface S3CompatibleConfig {
  endpoint: string
  bucket: string
  region?: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
  fetchFn?: typeof fetch
}

export interface BackupManifest {
  schemaVersion: 1
  generationId: string
  createdAt: string
  keyReference: string
  algorithm: 'aes-256-gcm'
  entries: ManifestEntry[]
  indexHash: string
  manifestHash?: string
}

export interface BackupGenerationResult {
  generationId: string
  manifest: BackupManifest
  manifestKey: string
  indexKey: string
  complete: boolean
  uploaded: number
  reused: number
}

export interface RestoreApproval {
  tier: 3
  approved: true
  approvalId: string
}

export interface RestorePreflight {
  targetId: string
  isolated: boolean
  existingRecords: number
  entries: number
  collisionPolicy: CollisionPolicy
}

export interface RestoreTargetPort {
  readonly targetId: string
  readonly isolation: 'isolated'
  preflight(): Promise<{ existingRecords: number }>
  hasRecord?(recordId: string): Promise<boolean>
  writeRecord(
    record: BackupRecord,
    collisionPolicy: CollisionPolicy,
  ): Promise<'created' | 'replaced' | 'skipped'>
  verify(): Promise<{ authenticated: boolean; readable: boolean; searchable: boolean }>
}

export interface RestoreOptions {
  mode: 'preflight' | 'dry-run' | 'restore'
  target: RestoreTargetPort
  collisionPolicy: CollisionPolicy
  approval?: RestoreApproval
  sampleSize?: number
}

export interface RestoreResult {
  generationId: string
  mode: RestoreOptions['mode']
  targetId: string
  preflight: RestorePreflight
  restored: number
  skipped: number
  replaced: number
  verifiedHashes: number
  failures: Array<{ recordId: string; code: string; message: string }>
  verification?: { authenticated: boolean; readable: boolean; searchable: boolean }
  backupSuccess: boolean
}

export interface RetentionPolicy {
  keepGenerations: number
}

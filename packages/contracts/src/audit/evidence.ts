import { Type, type Static } from '@sinclair/typebox'
import { EvidenceIdSchema } from '../common/id.js'
import { IsoTimestampSchema } from '../common/envelope.js'

export const EvidenceCheckTypeSchema = Type.Union([
  Type.Literal('dns_spf'),
  Type.Literal('dns_dkim'),
  Type.Literal('dns_dmarc'),
  Type.Literal('dns_mx'),
  Type.Literal('dns_ptr'),
  Type.Literal('port_25_open'),
  Type.Literal('tls_cert_valid'),
  Type.Literal('smtp_auth'),
  Type.Literal('imap_auth'),
  Type.Literal('jmap_auth'),
  Type.Literal('backup_integrity'),
  Type.Literal('restore_drill'),
  Type.Literal('migration_reconciliation'),
  Type.Literal('custom_check'),
])
export type EvidenceCheckType = Static<typeof EvidenceCheckTypeSchema>

export const EvidenceStatusSchema = Type.Union([
  Type.Literal('passed'),
  Type.Literal('warning'),
  Type.Literal('failed'),
  Type.Literal('unverified'),
])
export type EvidenceStatus = Static<typeof EvidenceStatusSchema>

export const EvidenceRecordSchema = Type.Object(
  {
    id: EvidenceIdSchema,
    checkType: EvidenceCheckTypeSchema,
    status: EvidenceStatusSchema,
    target: Type.String({ minLength: 1 }),
    collector: Type.String({ minLength: 1 }),
    observedAt: IsoTimestampSchema,
    details: Type.Record(Type.String(), Type.Unknown()),
    digest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })),
    rawOutputRedacted: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type EvidenceRecord = Static<typeof EvidenceRecordSchema>

import { describe, it, expect } from 'vitest'
import {
  IdSchema,
  AccountIdSchema,
  UserIdSchema,
  DomainIdSchema,
  MailboxIdSchema,
  SetupSessionIdSchema,
  SetupBlockIdSchema,
  ActionIdSchema,
  JobIdSchema,
  AuditIdSchema,
  EvidenceIdSchema,
  MessageIdSchema,
  ThreadIdSchema,
  VersionEnvelopeSchema,
  NavinSurfaceSchema,
  DeliveryChannelSchema,
  NavinErrorCodeSchema,
  NavinErrorSchema,
  validate,
  assertValid,
  isValid,
} from '../src/index.js'
import { Type } from '@sinclair/typebox'

describe('Common Contracts: IDs', () => {
  it('validates branded ID formats', () => {
    expect(isValid(AccountIdSchema, 'acc_01HXYZ789')).toBe(true)
    expect(isValid(AccountIdSchema, '')).toBe(false)
    expect(isValid(AccountIdSchema, 123)).toBe(false)

    expect(isValid(UserIdSchema, 'usr_admin123')).toBe(true)
    expect(isValid(DomainIdSchema, 'dom_example.com')).toBe(true)
    expect(isValid(MailboxIdSchema, 'mbx_inbox_user')).toBe(true)
    expect(isValid(MailboxIdSchema, 'fld_inbox')).toBe(false) // rejected old prefix
    expect(isValid(SetupSessionIdSchema, 'set_sess100')).toBe(true)
    expect(isValid(SetupBlockIdSchema, 'blk_discovery01')).toBe(true)
    expect(isValid(ActionIdSchema, 'act_prov_user')).toBe(true)
    expect(isValid(JobIdSchema, 'job_backup_42')).toBe(true)
    expect(isValid(AuditIdSchema, 'aud_rev_99')).toBe(true)
    expect(isValid(EvidenceIdSchema, 'evi_dkim_check')).toBe(true)
    expect(isValid(MessageIdSchema, 'msg_mail_001')).toBe(true)
    expect(isValid(ThreadIdSchema, 'thd_conv_777')).toBe(true)
  })

  it('rejects invalid or empty IDs', () => {
    expect(isValid(IdSchema, 'any-generic-id-123')).toBe(true)
    expect(isValid(IdSchema, '')).toBe(false)
    expect(isValid(IdSchema, 'has spaces')).toBe(false)
    expect(isValid(UserIdSchema, '')).toBe(false)
    expect(isValid(DomainIdSchema, '   ')).toBe(false)
    expect(isValid(ActionIdSchema, null)).toBe(false)
  })
})

describe('Common Contracts: Version Envelope', () => {
  const SamplePayloadSchema = Type.Object({
    name: Type.String(),
    active: Type.Boolean(),
  })
  const SampleEnvelopeSchema = VersionEnvelopeSchema(SamplePayloadSchema)

  it('validates a correct envelope', () => {
    const validEnvelope = {
      apiVersion: '1',
      kind: 'sample.event',
      id: 'evt_sample123',
      timestamp: '2026-10-01T12:00:00.000Z',
      payload: {
        name: 'test',
        active: true,
      },
      metadata: {
        sourceSurface: 'control',
      },
    }

    expect(isValid(SampleEnvelopeSchema, validEnvelope)).toBe(true)
    const result = validate(SampleEnvelopeSchema, validEnvelope)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.payload.name).toBe('test')
    }
  })

  it('rejects envelope with missing fields or invalid timestamp', () => {
    const invalidEnvelope = {
      apiVersion: '1',
      kind: 'sample.event',
      // missing id
      timestamp: 'not-a-timestamp',
      payload: { name: 'test', active: true },
    }

    expect(isValid(SampleEnvelopeSchema, invalidEnvelope)).toBe(false)
    expect(() => assertValid(SampleEnvelopeSchema, invalidEnvelope)).toThrow()
  })
})

describe('Common Contracts: Surface Identity', () => {
  it('accepts only allowed surfaces and delivery channels', () => {
    expect(isValid(NavinSurfaceSchema, 'mail')).toBe(true)
    expect(isValid(NavinSurfaceSchema, 'control')).toBe(true)
    expect(isValid(NavinSurfaceSchema, 'cli')).toBe(true)
    expect(isValid(NavinSurfaceSchema, 'admin')).toBe(false)

    expect(isValid(DeliveryChannelSchema, 'web')).toBe(true)
    expect(isValid(DeliveryChannelSchema, 'desktop')).toBe(true)
    expect(isValid(DeliveryChannelSchema, 'terminal')).toBe(true)
    expect(isValid(DeliveryChannelSchema, 'mobile')).toBe(false)
  })
})

describe('Common Contracts: Error Envelopes', () => {
  it('validates well-formed Navin error structures', () => {
    const validError = {
      code: 'RISK_STEP_UP_REQUIRED',
      message: 'Step-up authentication required for destructive action',
      surface: 'control',
      retryable: false,
      details: {
        requiredTier: 3,
        actionId: 'act_restore_123',
      },
      timestamp: '2026-10-01T12:00:00.000Z',
    }

    expect(isValid(NavinErrorSchema, validError)).toBe(true)
    const res = validate(NavinErrorSchema, validError)
    expect(res.success).toBe(true)
  })

  it('rejects invalid error codes', () => {
    const badError = {
      code: 'RANDOM_UNKNOWN_CODE',
      message: 'Something broke',
      retryable: true,
      timestamp: '2026-10-01T12:00:00.000Z',
    }

    expect(isValid(NavinErrorSchema, badError)).toBe(false)
  })

  it('validates canonical error codes', () => {
    const validCodes = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'RISK_STEP_UP_REQUIRED',
      'APPROVAL_REQUIRED',
      'IDEMPOTENCY_CONFLICT',
      'PRECONDITION_FAILED',
      'ACTION_BLOCKED',
      'SESSION_EXPIRED',
      'BAD_REQUEST',
    ]
    for (const code of validCodes) {
      expect(isValid(NavinErrorCodeSchema, code)).toBe(true)
    }
    expect(isValid(NavinErrorCodeSchema, 'UNKNOWN_ERROR')).toBe(false)
  })
})

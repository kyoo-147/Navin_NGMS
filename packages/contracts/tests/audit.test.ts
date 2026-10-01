import { describe, it, expect } from 'vitest'
import {
  AuditOutcomeSchema,
  AuditRecordSchema,
  EvidenceCheckTypeSchema,
  EvidenceStatusSchema,
  EvidenceRecordSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Audit & Evidence Contracts', () => {
  it('validates canonical audit outcomes and evidence statuses', () => {
    expect(isValid(AuditOutcomeSchema, 'success')).toBe(true)
    expect(isValid(AuditOutcomeSchema, 'failure')).toBe(true)
    expect(isValid(AuditOutcomeSchema, 'denied')).toBe(true)
    expect(isValid(AuditOutcomeSchema, 'other')).toBe(false)

    expect(isValid(EvidenceStatusSchema, 'passed')).toBe(true)
    expect(isValid(EvidenceStatusSchema, 'warning')).toBe(true)
    expect(isValid(EvidenceStatusSchema, 'failed')).toBe(true)
    expect(isValid(EvidenceStatusSchema, 'unverified')).toBe(true)
    expect(isValid(EvidenceStatusSchema, 'good')).toBe(false)

    const validCheckTypes = [
      'dns_spf',
      'dns_dkim',
      'dns_dmarc',
      'dns_mx',
      'dns_ptr',
      'port_25_open',
      'tls_cert_valid',
      'smtp_auth',
      'imap_auth',
      'jmap_auth',
      'backup_integrity',
      'restore_drill',
      'migration_reconciliation',
      'custom_check',
    ]
    for (const checkType of validCheckTypes) {
      expect(isValid(EvidenceCheckTypeSchema, checkType)).toBe(true)
    }
    expect(isValid(EvidenceCheckTypeSchema, 'invalid_check')).toBe(false)
  })

  it('validates a complete AuditRecord without sensitive secrets', () => {
    const auditRecord = {
      id: 'aud_action_1001',
      actor: {
        userId: 'usr_admin1',
        email: 'admin@production.example.invalid',
        role: 'ops.super_admin',
        surface: 'control',
        ipAddress: '198.51.100.10',
      },
      actionName: 'dns.update_dkim_selector',
      target: {
        domainId: 'dom_production.example.invalid',
        resourceType: 'domain',
      },
      outcome: 'success',
      riskTier: 2,
      approvalId: 'app_dkim_01',
      details: {
        selector: '202610a',
        keyType: 'ed25519',
      },
      timestamp: '2026-10-01T10:30:00.000Z',
    }

    expect(isValid(AuditRecordSchema, auditRecord)).toBe(true)
    const res = validate(AuditRecordSchema, auditRecord)
    expect(res.success).toBe(true)

    // Valid audit record targeting a mailbox
    const mailboxAuditRecord = {
      ...auditRecord,
      target: {
        mailboxId: 'mbx_user1',
        resourceType: 'mailbox',
      },
    }
    expect(isValid(AuditRecordSchema, mailboxAuditRecord)).toBe(true)

    // Negative: invalid mailboxId prefix in target
    const invalidMailboxAuditRecord = {
      ...auditRecord,
      target: {
        mailboxId: 'fld_user1',
        resourceType: 'mailbox',
      },
    }
    expect(isValid(AuditRecordSchema, invalidMailboxAuditRecord)).toBe(false)
  })

  it('validates EvidenceRecord with digest and verification status', () => {
    const evidence = {
      id: 'evi_spf_check_42',
      checkType: 'dns_spf',
      status: 'passed',
      target: 'production.example.invalid',
      collector: 'navind.network_inspector',
      observedAt: '2026-10-01T10:35:00.000Z',
      details: {
        record: 'v=spf1 mx ~all',
        lookupCount: 1,
        alignment: 'strict',
      },
      digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }

    expect(isValid(EvidenceRecordSchema, evidence)).toBe(true)
  })
})

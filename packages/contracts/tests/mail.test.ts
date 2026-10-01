import { describe, it, expect } from 'vitest'
import {
  MailQueryRequestSchema,
  MailQueryResponseSchema,
  MailMutationRequestSchema,
  MailMutationResponseSchema,
  MailSubmissionRequestSchema,
  MailSubmissionResponseSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Normalized Mail Contracts: Query, Mutation, and Submission', () => {
  it('validates a windowed MailQueryRequest with full-text filters and sorting', () => {
    const query = {
      accountId: 'acc_company_01',
      filter: {
        inMailbox: 'mbx_inbox',
        isUnread: true,
        text: 'invoice',
        hasAttachment: true,
        after: '2026-09-01T00:00:00.000Z',
      },
      sort: [{ field: 'date', direction: 'desc' }],
      position: 0,
      limit: 50,
      calculateTotal: true,
    }

    expect(isValid(MailQueryRequestSchema, query)).toBe(true)
    const res = validate(MailQueryRequestSchema, query)
    expect(res.success).toBe(true)
  })

  it('validates MailQueryResponse with state cursor', () => {
    const response = {
      accountId: 'acc_company_01',
      threadIds: ['thd_conv_1', 'thd_conv_2'],
      messageIds: ['msg_01', 'msg_02'],
      total: 2,
      position: 0,
      canCalculateChanges: true,
      queryState: 'state_tok_99182',
    }

    expect(isValid(MailQueryResponseSchema, response)).toBe(true)
  })

  it('validates MailMutationRequest with idempotency key and batch targets', () => {
    const mutation = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_mark_read_88',
      mutation: 'mark_read',
      targetIds: ['msg_01', 'msg_02'],
    }

    expect(isValid(MailMutationRequestSchema, mutation)).toBe(true)
    const res = validate(MailMutationRequestSchema, mutation)
    expect(res.success).toBe(true)
  })

  it('enforces conditional mutation fields (move/copy requires destinationFolderId; apply/remove label requires labelIds)', () => {
    // Valid move mutation
    const validMove = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_move_01',
      mutation: 'move',
      targetIds: ['msg_01'],
      destinationFolderId: 'fld_archive',
    }
    expect(isValid(MailMutationRequestSchema, validMove)).toBe(true)

    // Negative: move missing destinationFolderId
    const invalidMove = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_move_01',
      mutation: 'move',
      targetIds: ['msg_01'],
    }
    expect(isValid(MailMutationRequestSchema, invalidMove)).toBe(false)

    // Valid apply_label mutation
    const validApplyLabel = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_label_01',
      mutation: 'apply_label',
      targetIds: ['msg_01'],
      labelIds: ['lbl_invoices'],
    }
    expect(isValid(MailMutationRequestSchema, validApplyLabel)).toBe(true)

    // Negative: apply_label missing labelIds
    const missingLabels = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_label_01',
      mutation: 'apply_label',
      targetIds: ['msg_01'],
    }
    expect(isValid(MailMutationRequestSchema, missingLabels)).toBe(false)

    // Negative: apply_label with empty labelIds
    const emptyLabels = {
      accountId: 'acc_company_01',
      idempotencyKey: 'idemp_label_01',
      mutation: 'apply_label',
      targetIds: ['msg_01'],
      labelIds: [],
    }
    expect(isValid(MailMutationRequestSchema, emptyLabels)).toBe(false)
  })

  it('validates MailMutationResponse with undoToken', () => {
    const mutationRes = {
      success: true,
      idempotencyKey: 'idemp_mark_read_88',
      affectedCount: 2,
      undoToken: 'undo_tok_xyz123',
      newState: 'state_tok_99183',
    }

    expect(isValid(MailMutationResponseSchema, mutationRes)).toBe(true)
  })

  it('validates MailSubmissionRequest with RFC fields, senderIdentityId, scheduled send, and undo delay', () => {
    const submission = {
      accountId: 'acc_company_01',
      senderIdentityId: 'als_michael_primary',
      idempotencyKey: 'idemp_send_001',
      from: {
        name: 'Alice Example',
        address: 'alice@production.example.invalid',
      },
      to: [{ name: 'Partner', address: 'partner@example.org' }],
      subject: 'Phase 1 Architecture Specifications',
      bodyText: 'Please review the attached contract specs.',
      bodyHtml: '<p>Please review the attached contract specs.</p>',
      attachments: [
        {
          filename: 'spec.pdf',
          mimeType: 'application/pdf',
          size: 1048576,
          blobId: 'blob_pdf_123',
        },
      ],
      undoDelaySeconds: 10,
      sendAt: '2026-10-02T08:00:00.000Z',
    }

    expect(isValid(MailSubmissionRequestSchema, submission)).toBe(true)
    const res = validate(MailSubmissionRequestSchema, submission)
    expect(res.success).toBe(true)

    // Negative: missing senderIdentityId
    const missingSenderIdentity = { ...submission }
    delete (missingSenderIdentity as { senderIdentityId?: unknown }).senderIdentityId
    expect(isValid(MailSubmissionRequestSchema, missingSenderIdentity)).toBe(false)
  })

  it('validates MailSubmissionResponse with queued / held_for_undo status', () => {
    const submissionRes = {
      submissionId: 'sub_alpha_1',
      idempotencyKey: 'idemp_send_001',
      messageId: 'msg_sent_99',
      status: 'held_for_undo',
      undoWindowExpiresAt: '2026-10-01T10:00:10.000Z',
      submittedAt: '2026-10-01T10:00:00.000Z',
    }

    expect(isValid(MailSubmissionResponseSchema, submissionRes)).toBe(true)
  })
})

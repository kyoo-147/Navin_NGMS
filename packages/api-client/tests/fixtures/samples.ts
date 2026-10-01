export const now = '2026-10-01T10:00:00.000Z'

export function navinError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { code, message, retryable: false, timestamp: now, ...extra }
}

export function healthResponse(): Record<string, unknown> {
  return { status: 'ok', version: '0.1.0', uptimeMs: 1234 }
}

export function sessionPrincipal(): Record<string, unknown> {
  return {
    userId: 'usr_admin',
    accountId: 'acc_company_01',
    email: 'alice@example.com',
    roles: ['ops.super_admin'],
    scopes: ['control:*'],
  }
}

export function loginResponse(): Record<string, unknown> {
  return { principal: sessionPrincipal(), token: 'tok_control_1', expiresAt: now }
}

export function setupBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'blk_init_0',
    sessionId: 'set_alpha',
    schemaVersion: '1',
    stage: 'WELCOME',
    kind: 'question',
    status: 'passed',
    title: 'Welcome choices',
    summary: 'Selected: setup new mail server',
    canRetry: false,
    canRollback: false,
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function setupSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'set_alpha',
    title: 'New mail server setup',
    currentStage: 'DISCOVER',
    status: 'active',
    intelligenceMode: 'none',
    blocks: [setupBlock()],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job_1',
    name: 'system.discover',
    surface: 'control',
    status: 'running',
    cancellable: true,
    resumable: true,
    payload: {},
    createdAt: now,
    ...overrides,
  }
}

export function actionExecution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'act_1',
    name: 'system.discover',
    surface: 'control',
    stage: 'discover',
    status: 'staged',
    riskTier: 0,
    parameters: {},
    canRollback: false,
    requestedBy: 'usr_admin',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function auditRecord(): Record<string, unknown> {
  return {
    id: 'aud_1',
    actor: { userId: 'usr_admin', role: 'ops.super_admin', surface: 'control' },
    actionName: 'system.discover',
    target: { resourceType: 'host' },
    outcome: 'success',
    riskTier: 0,
    timestamp: now,
  }
}

export function evidenceRecord(): Record<string, unknown> {
  return {
    id: 'evi_1',
    checkType: 'custom_check',
    status: 'passed',
    target: 'local host',
    collector: 'unit-fixture',
    observedAt: now,
    details: {},
  }
}

export function mailQueryResponse(): Record<string, unknown> {
  return {
    accountId: 'acc_company_01',
    threadIds: ['thd_1'],
    messageIds: ['msg_1'],
    total: 1,
    position: 0,
    canCalculateChanges: true,
    queryState: 'state_1',
  }
}

export function mailMutationResponse(idempotencyKey: string): Record<string, unknown> {
  return { success: true, idempotencyKey, affectedCount: 1, newState: 'state_2' }
}

export function mailSubmissionResponse(idempotencyKey: string): Record<string, unknown> {
  return {
    submissionId: 'sub_1',
    idempotencyKey,
    messageId: 'msg_sent_1',
    status: 'queued',
    submittedAt: now,
  }
}

export function backgroundEvent(id: string): Record<string, unknown> {
  return {
    apiVersion: '1',
    kind: 'job.progress',
    id,
    timestamp: now,
    payload: { channel: 'jobs', status: 'running' },
  }
}

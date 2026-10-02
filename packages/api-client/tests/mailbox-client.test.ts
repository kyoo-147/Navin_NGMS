import { afterEach, describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import { ControlApiClient } from '../src/index.js'
import {
  startHttpFixture,
  sendJson,
  type HttpFixture,
  type RecordedRequest,
} from './fixtures/http-server.js'
import { actionExecution, evidenceRecord, job, navinError } from './fixtures/samples.js'

const fixtures: HttpFixture[] = []
const EMAIL = 'alice@example.com'
const PASSWORD = 'fixture-mailbox-secret-1234'

function actionView(status: 'planned' | 'completed' | 'rolled_back'): Record<string, unknown> {
  const action = actionExecution({
    id: 'act_mbx',
    name: 'organization.mailbox.create',
    stage: status === 'planned' ? 'plan' : status === 'completed' ? 'result' : 'rollback',
    status,
    riskTier: 1,
    parameters: { email: EMAIL, description: 'Alice' },
    canRollback: status === 'completed',
    ...(status === 'completed'
      ? {
          verification: {
            command: `verify mailbox ${EMAIL}`,
            expected: { name: 'alice' },
            actual: { name: 'alice', domainId: 'd1', description: 'Alice' },
            passed: true,
          },
        }
      : {}),
  })
  return {
    action,
    attempts: [],
    job: job({ name: 'organization.mailbox.provision', status: 'completed' }),
    evidence: status === 'completed' ? [evidenceRecord()] : [],
  }
}

function mailboxHandler(request: RecordedRequest, response: ServerResponse): void {
  switch (request.path) {
    case '/api/v1/control/organization/mailboxes/plan':
      sendJson(response, 200, actionView('planned'))
      return
    case '/api/v1/control/organization/mailboxes':
      sendJson(response, 200, actionView('completed'))
      return
    case '/api/v1/control/organization/mailboxes/actions/act_mbx':
      sendJson(response, 200, actionView('completed'))
      return
    case '/api/v1/control/organization/mailboxes/actions/act_mbx/rollback':
      sendJson(response, 200, actionView('rolled_back'))
      return
    default:
      sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
  }
}

async function createFixture(): Promise<HttpFixture> {
  const fixture = await startHttpFixture(mailboxHandler)
  fixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

describe('ControlApiClient mailbox organization actions', () => {
  it('plans a mailbox through the typed plan route without a mutation', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const view = await client.planMailbox({ email: EMAIL, description: 'Alice' })
    expect(view.action.id).toBe('act_mbx')
    expect(view.action.status).toBe('planned')

    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/mailboxes/plan')
    expect(record?.json()).toMatchObject({ email: EMAIL, description: 'Alice' })
  })

  it('provisions a mailbox with a body-only password and a stable idempotency key', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const view = await client.provisionMailbox({
      email: EMAIL,
      description: 'Alice',
      password: PASSWORD,
      confirm: true,
      idempotencyKey: 'org-mailbox-client-1',
    })
    expect(view.action.status).toBe('completed')
    expect(view.evidence).toHaveLength(1)

    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/mailboxes')
    expect(record?.headers['idempotency-key']).toBe('org-mailbox-client-1')
    expect(record?.json()).toMatchObject({
      email: EMAIL,
      password: PASSWORD,
      confirm: true,
      idempotencyKey: 'org-mailbox-client-1',
    })
    // The password is carried in the body only, never in the URL or query.
    expect(record?.url).not.toContain(PASSWORD)
    expect([...(record?.query.entries() ?? [])]).toHaveLength(0)
  })

  it('reads mailbox status and rolls back through the same action id with typed confirmation', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const status = await client.getMailboxAction('act_mbx')
    expect(status.action.status).toBe('completed')
    expect(fixture.requests.at(0)?.method).toBe('GET')
    expect(fixture.requests.at(0)?.path).toBe(
      '/api/v1/control/organization/mailboxes/actions/act_mbx',
    )

    const rolled = await client.rollbackMailbox('act_mbx', { confirmation: EMAIL })
    expect(rolled.action.status).toBe('rolled_back')
    const record = fixture.requests.at(1)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/mailboxes/actions/act_mbx/rollback')
    expect(record?.json()).toEqual({ confirmation: EMAIL })
    // There is no way to express a `--yes` bypass on the typed request.
    expect(record?.json()).not.toHaveProperty('yes')
    expect(record?.json()).not.toHaveProperty('force')
  })

  it('rejects an invalid address or short password before it reaches the transport', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    await expect(client.planMailbox({ email: 'not an address' })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    })
    await expect(
      client.provisionMailbox({ email: EMAIL, password: 'short', confirm: true }),
    ).rejects.toMatchObject({ code: 'REQUEST_VALIDATION_FAILED' })
    expect(fixture.requests).toHaveLength(0)
  })
})

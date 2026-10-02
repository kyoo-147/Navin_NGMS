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
const DOMAIN = 'company.test'

function actionView(status: 'planned' | 'completed' | 'rolled_back'): Record<string, unknown> {
  const action = actionExecution({
    id: 'act_dom',
    name: 'organization.domain.create',
    stage: status === 'planned' ? 'plan' : status === 'completed' ? 'result' : 'rollback',
    status,
    riskTier: 1,
    parameters: { name: DOMAIN },
    canRollback: true,
    ...(status === 'completed'
      ? {
          verification: {
            command: `verify domain ${DOMAIN}`,
            expected: { name: DOMAIN },
            actual: { name: DOMAIN },
            passed: true,
          },
        }
      : {}),
  })
  return {
    action,
    attempts: [],
    job: job({ name: 'organization.domain.provision', status: 'completed' }),
    evidence: status === 'completed' ? [evidenceRecord()] : [],
  }
}

function domainHandler(request: RecordedRequest, response: ServerResponse): void {
  switch (request.path) {
    case '/api/v1/control/organization/domains/plan':
      sendJson(response, 200, actionView('planned'))
      return
    case '/api/v1/control/organization/domains':
      sendJson(response, 200, actionView('completed'))
      return
    case '/api/v1/control/organization/domains/actions/act_dom':
      sendJson(response, 200, actionView('completed'))
      return
    case '/api/v1/control/organization/domains/actions/act_dom/rollback':
      sendJson(response, 200, actionView('rolled_back'))
      return
    default:
      sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
  }
}

async function createFixture(): Promise<HttpFixture> {
  const fixture = await startHttpFixture(domainHandler)
  fixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

describe('ControlApiClient domain organization actions', () => {
  it('plans a domain through the typed plan route without a mutation', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const view = await client.planDomain({ name: DOMAIN, description: 'Primary' })
    expect(view.action.id).toBe('act_dom')
    expect(view.action.status).toBe('planned')

    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/domains/plan')
    expect(record?.json()).toMatchObject({ name: DOMAIN, description: 'Primary' })
  })

  it('provisions a domain and forwards the stable idempotency key', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const view = await client.provisionDomain({
      name: DOMAIN,
      confirm: true,
      idempotencyKey: 'org-domain-client-1',
    })
    expect(view.action.status).toBe('completed')
    expect(view.evidence).toHaveLength(1)

    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/domains')
    expect(record?.headers['idempotency-key']).toBe('org-domain-client-1')
    expect(record?.json()).toMatchObject({ name: DOMAIN, confirm: true })
  })

  it('reads domain action status and rolls it back through the same action id', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    const status = await client.getDomainAction('act_dom')
    expect(status.action.status).toBe('completed')
    expect(fixture.requests.at(0)?.method).toBe('GET')
    expect(fixture.requests.at(0)?.path).toBe(
      '/api/v1/control/organization/domains/actions/act_dom',
    )

    const rolled = await client.rollbackDomain('act_dom')
    expect(rolled.action.status).toBe('rolled_back')
    expect(fixture.requests.at(1)?.method).toBe('POST')
    expect(fixture.requests.at(1)?.path).toBe(
      '/api/v1/control/organization/domains/actions/act_dom/rollback',
    )
  })

  it('rejects an invalid domain request before it reaches the transport', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    await expect(client.planDomain({ name: 'Not A Domain' })).rejects.toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    })
    expect(fixture.requests).toHaveLength(0)
  })
})

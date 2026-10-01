import { afterEach, describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import type { AccountId } from '@navin/contracts'
import {
  ControlApiClient,
  MailApiClient,
  bearerAuthContext,
  cookieAuthContext,
} from '../src/index.js'
import {
  startHttpFixture,
  sendJson,
  type HttpFixture,
  type RecordedRequest,
} from './fixtures/http-server.js'
import {
  actionExecution,
  auditRecord,
  evidenceRecord,
  healthResponse,
  job,
  loginResponse,
  mailQueryResponse,
  navinError,
  sessionPrincipal,
  setupSession,
} from './fixtures/samples.js'

const fixtures: HttpFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

function controlHandler(request: RecordedRequest, response: ServerResponse): void {
  switch (request.path) {
    case '/api/v1/health':
      sendJson(response, 200, healthResponse())
      return
    case '/api/v1/auth/login':
      sendJson(response, 200, loginResponse())
      return
    case '/api/v1/auth/session':
      sendJson(response, 200, sessionPrincipal())
      return
    case '/api/v1/setup/sessions':
      if (request.method === 'POST') {
        sendJson(response, 201, setupSession())
      } else {
        sendJson(response, 200, { sessions: [setupSession()] })
      }
      return
    case '/api/v1/setup/sessions/set_alpha':
      sendJson(response, 200, setupSession())
      return
    case '/api/v1/setup/sessions/set_alpha/resume':
      sendJson(response, 200, setupSession({ status: 'active' }))
      return
    case '/api/v1/control/actions/act_1':
      sendJson(response, 200, actionExecution())
      return
    case '/api/v1/control/jobs/job_1':
      sendJson(response, 200, job())
      return
    case '/api/v1/control/jobs/job_1/cancel':
      sendJson(response, 200, job({ status: 'cancelled' }))
      return
    case '/api/v1/control/audit':
      sendJson(response, 200, { records: [auditRecord()] })
      return
    case '/api/v1/mail/query':
      sendJson(response, 200, mailQueryResponse())
      return
    case '/api/v1/control/evidence/evi_1':
      sendJson(response, 200, evidenceRecord())
      return
    default:
      sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
  }
}

async function createFixture(): Promise<HttpFixture> {
  const fixture = await startHttpFixture(controlHandler)
  fixtures.push(fixture)
  return fixture
}

describe('ControlApiClient', () => {
  it('drives the setup, job, action, audit and evidence resources', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })

    expect(await client.health()).toBeDefined()
    const principal = await client.whoami()
    expect(principal.userId).toBe('usr_admin')

    const sessions = await client.listSetupSessions()
    expect(sessions).toHaveLength(1)
    expect(await client.getSetupSession('set_alpha')).toMatchObject({ id: 'set_alpha' })
    expect(await client.createSetupSession({ title: 'New setup' })).toMatchObject({
      id: 'set_alpha',
    })
    expect(await client.resumeSetupSession('set_alpha')).toMatchObject({ status: 'active' })

    expect(await client.getAction('act_1')).toMatchObject({ id: 'act_1', stage: 'discover' })
    expect(await client.getJob('job_1')).toMatchObject({ id: 'job_1', status: 'running' })
    expect(await client.cancelJob('job_1')).toMatchObject({ status: 'cancelled' })

    const audit = await client.listAudit()
    expect(audit).toHaveLength(1)
    expect(await client.getEvidence('evi_1')).toMatchObject({ id: 'evi_1', status: 'passed' })
  })

  it('logs in and returns the session principal', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const response = await client.login({
      email: 'alice@example.com',
      password: 'secret',
      relyingParty: 'navin-control',
    })
    expect(response.token).toBe('tok_control_1')
    expect(response.principal.roles).toContain('ops.super_admin')
  })

  it('keeps Mail and Control auth contexts separate', async () => {
    const fixture = await createFixture()

    const control = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      auth: bearerAuthContext({ surface: 'control', token: 'ctl-token' }),
    })
    await control.health()

    const cli = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      surface: 'cli',
      auth: bearerAuthContext({ surface: 'cli', token: () => 'cli-token' }),
    })
    await cli.health()

    const mail = new MailApiClient({
      baseUrl: fixture.baseUrl,
      auth: cookieAuthContext({ surface: 'mail' }),
    })
    await mail.query({ accountId: 'acc_company_01' as AccountId, position: 0, limit: 10 })

    const [controlRequest, cliRequest, mailRequest] = fixture.requests
    expect(controlRequest?.headers['x-navin-surface']).toBe('control')
    expect(controlRequest?.headers.authorization).toBe('Bearer ctl-token')
    expect(cliRequest?.headers['x-navin-surface']).toBe('cli')
    expect(cliRequest?.headers.authorization).toBe('Bearer cli-token')
    expect(mailRequest?.headers['x-navin-surface']).toBe('mail')
    expect(mailRequest?.headers.authorization).toBeUndefined()
  })

  it('resumes by id without repeating a mutation', async () => {
    const fixture = await createFixture()
    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    await client.resumeSetupSession('set_alpha')
    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/setup/sessions/set_alpha/resume')
  })

  it('supports an injected transport for non-fetch environments', async () => {
    const fixture = await createFixture()
    const seen: string[] = []
    const client = new ControlApiClient({
      baseUrl: fixture.baseUrl,
      transport: {
        async send(request) {
          seen.push(request.url)
          const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            signal: request.signal,
          })
          return {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            text: () => response.text(),
            body: null,
          }
        },
      },
    })

    await client.health()
    expect(seen).toEqual([`${fixture.baseUrl}/api/v1/health`])
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import type { MailQueryRequest } from '@navin/contracts'
import { MailApiClient, type MailMutationInput, type MailSubmissionInput } from '../src/index.js'
import {
  startHttpFixture,
  sendJson,
  type HttpFixture,
  type RecordedRequest,
} from './fixtures/http-server.js'
import {
  mailMutationResponse,
  mailQueryResponse,
  mailSubmissionResponse,
  navinError,
} from './fixtures/samples.js'

const fixtures: HttpFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

// Contract IDs are branded; tests build them from literals at the JSON boundary.
function loose<T>(value: unknown): T {
  return value as T
}

function mailHandler(request: RecordedRequest, response: ServerResponse): void {
  if (request.path === '/api/v1/mail/query') {
    sendJson(response, 200, mailQueryResponse())
    return
  }
  if (request.path === '/api/v1/mail/mutations') {
    const body = request.json<{ idempotencyKey: string }>()
    sendJson(response, 200, mailMutationResponse(body.idempotencyKey))
    return
  }
  if (request.path === '/api/v1/mail/submissions') {
    const body = request.json<{ idempotencyKey: string }>()
    sendJson(response, 200, mailSubmissionResponse(body.idempotencyKey))
    return
  }
  sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
}

async function createFixture(): Promise<HttpFixture> {
  const fixture = await startHttpFixture(mailHandler)
  fixtures.push(fixture)
  return fixture
}

describe('MailApiClient', () => {
  it('queries the mailbox with the mail surface and no control credentials', async () => {
    const fixture = await createFixture()
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    const page = await client.query(
      loose<MailQueryRequest>({ accountId: 'acc_company_01', position: 0, limit: 50 }),
    )

    expect(page).toEqual(mailQueryResponse())
    const record = fixture.requests.at(0)
    expect(record?.method).toBe('POST')
    expect(record?.headers['x-navin-surface']).toBe('mail')
    expect(record?.headers.authorization).toBeUndefined()
    expect(record?.json()).toMatchObject({ accountId: 'acc_company_01', limit: 50 })
  })

  it('auto-generates an idempotency key for mutations and sends it as a header', async () => {
    const fixture = await createFixture()
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    const result = await client.mutate(
      loose<MailMutationInput>({
        accountId: 'acc_company_01',
        mutation: 'mark_read',
        targetIds: ['msg_01'],
      }),
    )

    const record = fixture.requests.at(0)
    const body = record?.json<{ idempotencyKey: string }>()
    expect(body?.idempotencyKey).toMatch(/^idmp_[a-z0-9]+$/)
    expect(record?.headers['idempotency-key']).toBe(body?.idempotencyKey)
    expect(result.idempotencyKey).toBe(body?.idempotencyKey)
  })

  it('preserves a caller-provided idempotency key', async () => {
    const fixture = await createFixture()
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    await client.mutate(
      loose<MailMutationInput>({
        accountId: 'acc_company_01',
        mutation: 'star',
        targetIds: ['msg_01'],
        idempotencyKey: 'idemp_explicit_1',
      }),
    )

    const record = fixture.requests.at(0)
    expect(record?.headers['idempotency-key']).toBe('idemp_explicit_1')
    expect(record?.json<{ idempotencyKey: string }>().idempotencyKey).toBe('idemp_explicit_1')
  })

  it('submits a message with a generated idempotency key', async () => {
    const fixture = await createFixture()
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    const result = await client.submit(
      loose<MailSubmissionInput>({
        accountId: 'acc_company_01',
        senderIdentityId: 'als_alice_primary',
        from: { name: 'Alice', address: 'alice@example.com' },
        to: [{ address: 'bob@example.org' }],
        subject: 'Phase 1',
        bodyText: 'Please review.',
      }),
    )

    expect(result.status).toBe('queued')
    expect(result.idempotencyKey).toMatch(/^idmp_/)
    expect(fixture.requests.at(0)?.headers['idempotency-key']).toBe(result.idempotencyKey)
  })

  it('rejects an invalid submission before sending it', async () => {
    const fixture = await createFixture()
    const client = new MailApiClient({ baseUrl: fixture.baseUrl })

    await expect(
      client.submit(
        loose<MailSubmissionInput>({
          accountId: 'acc_company_01',
          senderIdentityId: 'als_alice_primary',
          from: { address: 'alice@example.com' },
          to: [{ address: 'not-an-address' }],
          subject: 'Phase 1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_VALIDATION_FAILED' })
    expect(fixture.requests).toHaveLength(0)
  })
})

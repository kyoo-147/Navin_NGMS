import { afterEach, describe, expect, it } from 'vitest'
import type { ApiClientError } from '../src/index.js'
import { ControlApiClient, type SseEvent } from '../src/index.js'
import {
  openSse,
  sendJson,
  singleHeader,
  startHttpFixture,
  writeSseEvent,
  type HttpFixture,
  type RecordedRequest,
} from './fixtures/http-server.js'
import { backgroundEvent, navinError } from './fixtures/samples.js'
import { waitFor } from './helpers.js'
import type { NavinEvent } from '../src/schemas.js'

const fixtures: HttpFixture[] = []

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()
    if (fixture) await fixture.close()
  }
})

async function createFixture(
  handler: Parameters<typeof startHttpFixture>[0],
): Promise<HttpFixture> {
  const fixture = await startHttpFixture(handler)
  fixtures.push(fixture)
  return fixture
}

const FAST_RETRY = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 'none' as const }

function lastEventIdOf(request: RecordedRequest | undefined): string | undefined {
  return singleHeader(request?.headers['last-event-id'])
}

describe('SSE streaming', () => {
  it('reconnects with Last-Event-ID and resumes the event sequence', async () => {
    let connections = 0
    const fixture = await createFixture((request, response) => {
      if (request.path !== '/api/v1/events') {
        sendJson(response, 404, navinError('NOT_FOUND', 'no route'))
        return
      }
      connections += 1
      openSse(response)
      if (connections <= 2) {
        const start = Number(lastEventIdOf(request) ?? '0')
        for (let offset = 1; offset <= 2; offset += 1) {
          const id = String(start + offset)
          writeSseEvent(response, {
            id,
            event: 'job.progress',
            data: JSON.stringify(backgroundEvent(`evt_${id}`)),
          })
        }
      }
      response.end()
    })

    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const received: string[] = []
    const subscription = client.events({
      retry: FAST_RETRY,
      onEvent: (event: SseEvent<NavinEvent>) => received.push(event.id ?? '?'),
    })

    await subscription.done

    expect(received).toEqual(['1', '2', '3', '4'])
    expect(subscription.lastEventId).toBe('4')
    expect(subscription.closed).toBe(true)

    const sseRequests = fixture.requestsFor('/api/v1/events')
    expect(lastEventIdOf(sseRequests.at(0))).toBeUndefined()
    expect(lastEventIdOf(sseRequests.at(1))).toBe('2')
    expect(lastEventIdOf(sseRequests.at(2))).toBe('4')
  })

  it('bounds reconnection attempts when the stream endpoint keeps failing', async () => {
    let attempts = 0
    const fixture = await createFixture((_request, response) => {
      attempts += 1
      sendJson(response, 503, navinError('SERVICE_UNAVAILABLE', 'down', { retryable: true }))
    })

    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const errors: ApiClientError[] = []
    const subscription = client.events({
      retry: FAST_RETRY,
      onError: (error) => errors.push(error),
    })

    await subscription.done

    expect(attempts).toBe(3)
    expect(errors).toHaveLength(3)
    expect(errors.every((error) => error.code === 'SERVICE_UNAVAILABLE')).toBe(true)
  })

  it('stops streaming when the subscription is closed', async () => {
    const fixture = await createFixture((_request, response) => {
      openSse(response)
      let sequence = 0
      const timer = setInterval(() => {
        sequence += 1
        writeSseEvent(response, {
          id: String(sequence),
          event: 'job.progress',
          data: JSON.stringify(backgroundEvent(`evt_${sequence}`)),
        })
      }, 5)
      response.on('close', () => clearInterval(timer))
    })

    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const received: string[] = []
    const subscription = client.events({
      onEvent: (event: SseEvent<NavinEvent>) => received.push(event.id ?? '?'),
    })

    await waitFor(() => received.length >= 2)
    subscription.close()
    await subscription.done

    expect(subscription.closed).toBe(true)
    expect(received.length).toBeGreaterThanOrEqual(2)
  })

  it('reports an error for events that fail schema validation', async () => {
    const fixture = await createFixture((_request, response) => {
      openSse(response)
      writeSseEvent(response, { id: '1', event: 'bad', data: JSON.stringify({ nope: true }) })
      response.end()
    })

    const client = new ControlApiClient({ baseUrl: fixture.baseUrl })
    const errors: ApiClientError[] = []
    const subscription = client.events({
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, jitter: 'none' },
      onError: (error) => errors.push(error),
    })

    await subscription.done
    expect(errors.some((error) => error.code === 'RESPONSE_VALIDATION_FAILED')).toBe(true)
  })
})

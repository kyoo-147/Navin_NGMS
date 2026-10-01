import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

interface CapturedRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: Record<string, unknown> | undefined
}

const requests: CapturedRequest[] = []
let server: Server
let baseUrl = ''

function iso(): string {
  return new Date().toISOString()
}

function planView() {
  return {
    action: {
      id: 'act_test1',
      name: 'organization.alias.create',
      surface: 'control',
      stage: 'plan',
      status: 'planned',
      riskTier: 1,
      parameters: { address: 'sales@example.com', target: 'alice@example.com' },
      diff: {
        summary: 'Create alias sales@example.com',
        changes: [{ path: 'name', op: 'add', newValue: 'sales' }],
      },
      canRollback: true,
      requestedBy: 'usr_test',
      createdAt: iso(),
      updatedAt: iso(),
    },
    attempts: [],
    evidence: [],
  }
}

function completedView() {
  return {
    action: {
      id: 'act_test1',
      name: 'organization.alias.create',
      surface: 'control',
      stage: 'result',
      status: 'completed',
      riskTier: 1,
      parameters: { address: 'sales@example.com', target: 'alice@example.com' },
      verification: {
        command: 'verify alias sales@example.com',
        expected: { name: 'sales' },
        actual: { name: 'sales', target: 'alice@example.com' },
        passed: true,
      },
      canRollback: true,
      requestedBy: 'usr_test',
      createdAt: iso(),
      updatedAt: iso(),
    },
    attempts: [{ id: 'att_1', actionId: 'act_test1', attempt: 1, status: 'succeeded' }],
    job: { id: 'job_test1', name: 'organization.alias.provision', status: 'completed' },
    evidence: [{ id: 'evi_1', status: 'passed', target: 'alias:sales@example.com' }],
  }
}

function rolledBackView() {
  const view = completedView()
  return { ...view, action: { ...view.action, stage: 'rollback', status: 'rolled_back' } }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  }
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = await readBody(req)
      requests.push({
        method: req.method ?? 'GET',
        path: url.pathname,
        headers: req.headers as Record<string, string | undefined>,
        body,
      })
      if (url.pathname === '/api/v1/control/organization/aliases/plan') {
        respond(res, 200, planView())
      } else if (url.pathname === '/api/v1/control/organization/aliases') {
        respond(res, 200, completedView())
      } else if (url.pathname.endsWith('/rollback')) {
        respond(res, 200, rolledBackView())
      } else if (url.pathname.startsWith('/api/v1/control/organization/actions/')) {
        respond(res, 200, completedView())
      } else {
        respond(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('navin alias CLI', () => {
  it('fails closed without --yes and sends no mutation request', async () => {
    requests.length = 0
    const result = await runCli(
      ['alias', 'create', '--address', 'sales@example.com', '--target', 'alice@example.com'],
      { apiUrl: baseUrl, token: 'test-token' },
    )
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('requires explicit confirmation')
    expect(requests).toHaveLength(0)
  })

  it('plans an alias and prints the same action id and diff', async () => {
    requests.length = 0
    const result = await runCli(
      ['alias', 'plan', '--address', 'sales@example.com', '--target', 'alice@example.com'],
      { apiUrl: baseUrl, token: 'test-token' },
    )
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('act_test1')
    expect(result.output).toContain('add name')
    expect(requests[0]?.path).toBe('/api/v1/control/organization/aliases/plan')
    expect(requests[0]?.body).toMatchObject({
      address: 'sales@example.com',
      target: 'alice@example.com',
    })
  })

  it('provisions an alias with confirmation and a stable idempotency key', async () => {
    requests.length = 0
    const result = await runCli(
      [
        'alias',
        'create',
        '--address',
        'sales@example.com',
        '--target',
        'alice@example.com',
        '--yes',
        '--idempotency-key',
        'org-key-1',
      ],
      { apiUrl: baseUrl, token: 'test-token' },
    )
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('completed')
    const create = requests.find(
      (request) => request.path === '/api/v1/control/organization/aliases',
    )
    expect(create?.body).toMatchObject({ confirm: true, idempotencyKey: 'org-key-1' })
    expect(create?.headers['idempotency-key']).toBe('org-key-1')
  })

  it('shows action status by id and rolls back through the same id', async () => {
    requests.length = 0
    const status = await runCli(['alias', 'status', 'act_test1'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(status.exitCode).toBe(0)
    expect(status.output).toContain('act_test1')
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.path).toBe('/api/v1/control/organization/actions/act_test1')

    requests.length = 0
    const rollback = await runCli(['alias', 'rollback', 'act_test1'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(rollback.exitCode).toBe(0)
    expect(rollback.output).toContain('rolled_back')
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.path).toBe('/api/v1/control/organization/actions/act_test1/rollback')
  })

  it('emits a stable --json envelope for scripting', async () => {
    const result = await runCli(['alias', 'status', 'act_test1', '--json'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as { action: { id: string; status: string } }
    expect(parsed.action.id).toBe('act_test1')
    expect(parsed.action.status).toBe('completed')
  })
})

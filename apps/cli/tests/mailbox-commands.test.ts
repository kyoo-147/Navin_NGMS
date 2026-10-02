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

const EMAIL = 'alice@example.com'
const PASSWORD = 'cli-mailbox-secret-1234'

function iso(): string {
  return new Date().toISOString()
}

function planView() {
  return {
    action: {
      id: 'act_mbx1',
      name: 'organization.mailbox.create',
      surface: 'control',
      stage: 'plan',
      status: 'planned',
      riskTier: 1,
      parameters: { email: EMAIL, description: 'Alice' },
      diff: {
        summary: `Create mailbox ${EMAIL}`,
        changes: [{ path: 'name', op: 'add', newValue: 'alice' }],
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
      id: 'act_mbx1',
      name: 'organization.mailbox.create',
      surface: 'control',
      stage: 'result',
      status: 'completed',
      riskTier: 1,
      parameters: { email: EMAIL, description: 'Alice' },
      verification: {
        command: `verify mailbox ${EMAIL}`,
        expected: { name: 'alice' },
        actual: { name: 'alice', domainId: 'd1', description: 'Alice' },
        passed: true,
      },
      canRollback: true,
      requestedBy: 'usr_test',
      createdAt: iso(),
      updatedAt: iso(),
    },
    attempts: [{ id: 'att_1', actionId: 'act_mbx1', attempt: 1, status: 'succeeded' }],
    job: { id: 'job_mbx1', name: 'organization.mailbox.provision', status: 'completed' },
    evidence: [{ id: 'evi_1', status: 'passed', target: `mailbox:${EMAIL}` }],
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
      if (url.pathname === '/api/v1/control/organization/mailboxes/plan') {
        respond(res, 200, planView())
      } else if (url.pathname === '/api/v1/control/organization/mailboxes') {
        respond(res, 200, completedView())
      } else if (url.pathname.endsWith('/rollback')) {
        respond(res, 200, rolledBackView())
      } else if (url.pathname.startsWith('/api/v1/control/organization/mailboxes/actions/')) {
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

describe('navin mailbox CLI', () => {
  const stdinPassword = { readPasswordFromStdin: async (): Promise<string> => PASSWORD }

  it('fails closed without --yes and sends no mutation request', async () => {
    requests.length = 0
    const result = await runCli(
      ['mailbox', 'create', '--email', EMAIL, '--password-stdin'],
      { apiUrl: baseUrl, token: 'test-token' },
      stdinPassword,
    )
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('requires explicit confirmation')
    expect(requests).toHaveLength(0)
  })

  it('rejects the plaintext --password flag without reading or sending it', async () => {
    requests.length = 0
    const result = await runCli(
      ['mailbox', 'create', '--email', EMAIL, '--password', PASSWORD, '--yes'],
      { apiUrl: baseUrl, token: 'test-token' },
      stdinPassword,
    )
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('plaintext --password is not supported')
    expect(result.output).not.toContain(PASSWORD)
    expect(requests).toHaveLength(0)
  })

  it('fails closed without --password-stdin and sends no mutation request', async () => {
    requests.length = 0
    const result = await runCli(['mailbox', 'create', '--email', EMAIL, '--yes'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('--password-stdin is required')
    expect(requests).toHaveLength(0)
  })

  it('fails closed when --password-stdin has no stdin reader', async () => {
    requests.length = 0
    const result = await runCli(
      ['mailbox', 'create', '--email', EMAIL, '--password-stdin', '--yes'],
      { apiUrl: baseUrl, token: 'test-token' },
    )
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('cannot be read in this context')
    expect(requests).toHaveLength(0)
  })

  it('plans a mailbox and prints the same action id and diff', async () => {
    requests.length = 0
    const result = await runCli(['mailbox', 'plan', '--email', EMAIL, '--description', 'Alice'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('act_mbx1')
    expect(result.output).toContain('add name')
    expect(requests[0]?.path).toBe('/api/v1/control/organization/mailboxes/plan')
    expect(requests[0]?.body).toMatchObject({ email: EMAIL, description: 'Alice' })
    expect(requests[0]?.body).not.toHaveProperty('password')
  })

  it('provisions a mailbox whose password comes from stdin and is never printed', async () => {
    requests.length = 0
    const result = await runCli(
      [
        'mailbox',
        'create',
        '--email',
        EMAIL,
        '--password-stdin',
        '--yes',
        '--idempotency-key',
        'org-mailbox-key-1',
      ],
      { apiUrl: baseUrl, token: 'test-token' },
      stdinPassword,
    )
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('completed')
    expect(result.output).not.toContain(PASSWORD)
    const create = requests.find(
      (request) => request.path === '/api/v1/control/organization/mailboxes',
    )
    expect(create?.body).toMatchObject({
      email: EMAIL,
      password: PASSWORD,
      confirm: true,
      idempotencyKey: 'org-mailbox-key-1',
    })
    expect(create?.headers['idempotency-key']).toBe('org-mailbox-key-1')
  })

  it('shows mailbox action status by id', async () => {
    requests.length = 0
    const status = await runCli(['mailbox', 'status', 'act_mbx1'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(status.exitCode).toBe(0)
    expect(status.output).toContain('act_mbx1')
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.path).toBe('/api/v1/control/organization/mailboxes/actions/act_mbx1')
  })

  it('rollback requires the typed address and can never be bypassed with --yes', async () => {
    requests.length = 0
    const missing = await runCli(['mailbox', 'rollback', 'act_mbx1'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(missing.exitCode).toBe(1)
    expect(missing.output).toContain('requires typed confirmation')

    requests.length = 0
    const bypass = await runCli(['mailbox', 'rollback', 'act_mbx1', '--yes'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(bypass.exitCode).toBe(1)
    expect(bypass.output).toContain('cannot be bypassed with --yes')
    expect(requests).toHaveLength(0)

    requests.length = 0
    const rollback = await runCli(['mailbox', 'rollback', 'act_mbx1', '--confirm', EMAIL], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(rollback.exitCode).toBe(0)
    expect(rollback.output).toContain('rolled_back')
    const record = requests[0]
    expect(record?.method).toBe('POST')
    expect(record?.path).toBe('/api/v1/control/organization/mailboxes/actions/act_mbx1/rollback')
    expect(record?.body).toEqual({ confirmation: EMAIL })
  })

  it('emits a stable --json envelope for scripting', async () => {
    const result = await runCli(['mailbox', 'status', 'act_mbx1', '--json'], {
      apiUrl: baseUrl,
      token: 'test-token',
    })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output) as { action: { id: string; status: string } }
    expect(parsed.action.id).toBe('act_mbx1')
    expect(parsed.action.status).toBe('completed')
  })
})

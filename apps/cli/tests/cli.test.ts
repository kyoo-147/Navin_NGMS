import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

interface SetupTestBlock {
  kind: string
  status: string
  value?: unknown
  [key: string]: unknown
}

interface SetupTestSession {
  blocks: SetupTestBlock[]
  status: string
  currentStage: string
  [key: string]: unknown
}

describe('Navin CLI', () => {
  let server: Server
  let port: number
  let baseUrl: string
  let tempConfigDir: string
  let previousConfigDir: string | undefined
  const sessions = new Map<string, SetupTestSession>()

  beforeAll(async () => {
    previousConfigDir = process.env.NAVIN_CONFIG_DIR
    tempConfigDir = mkdtempSync(join(tmpdir(), 'navin-cli-test-'))
    process.env.NAVIN_CONFIG_DIR = tempConfigDir
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`)
      const surface = req.headers['x-navin-surface']

      if (surface !== 'cli') {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'surface cli required' } }))
        return
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', service: 'navind', version: '0.1.0' }))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ token: 'test-token-123', expiresAt: '2030-01-01T00:00:00Z' }))
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/auth/session') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            userId: 'usr_1',
            email: 'alice@example.com',
            roles: ['ops.super_admin'],
            scopes: ['control:discover', 'control:approve', 'control:apply'],
          }),
        )
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/setup/sessions') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ sessions: Array.from(sessions.values()) }))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/setup/sessions') {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}')
          const id = 'set_0123456789abcdef0123456789abcdef'
          const session = {
            id,
            title: parsed.title || 'CLI Test Setup',
            currentStage: 'DISCOVER',
            status: 'active',
            intelligenceMode: 'none',
            blocks: [
              {
                id: 'blk_1',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'DISCOVER',
                kind: 'discovery',
                status: 'ready',
                title: 'Discovery Block',
                summary: 'Inspect loopback',
                risk: 'read',
                canRetry: true,
                canRollback: false,
                dependencies: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'blk_2',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'PLAN',
                kind: 'plan',
                status: 'pending',
                title: 'Plan Block',
                summary: 'Build setup plan',
                risk: 'staged',
                canRetry: true,
                canRollback: false,
                dependencies: ['blk_1'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'blk_3',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'PLAN',
                kind: 'diff',
                status: 'pending',
                title: 'Diff Block',
                summary: 'Review diff',
                risk: 'shared',
                canRetry: true,
                canRollback: false,
                dependencies: ['blk_2'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'blk_4',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'APPROVAL',
                kind: 'approval',
                status: 'pending',
                title: 'Approve Block',
                summary: 'Approve setup',
                risk: parsed.destructive ? 'destructive' : 'shared',
                canRetry: false,
                canRollback: false,
                dependencies: ['blk_3'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'blk_5',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'APPLY',
                kind: 'action',
                status: 'pending',
                title: 'Apply Block',
                summary: 'Apply setup',
                risk: parsed.destructive ? 'destructive' : 'shared',
                canRetry: true,
                canRollback: true,
                dependencies: ['blk_4'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'blk_6',
                sessionId: id,
                schemaVersion: 'setup.v1',
                stage: 'VERIFY_INFRA',
                kind: 'verification',
                status: 'pending',
                title: 'Verify Block',
                summary: 'Verify state',
                risk: 'read',
                canRetry: true,
                canRollback: false,
                dependencies: ['blk_5'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          sessions.set(id, session)
          res.writeHead(201, { 'content-type': 'application/json' })
          res.end(JSON.stringify(session))
        })
        return
      }

      const matchGet = url.pathname.match(/^\/api\/v1\/setup\/sessions\/([^/]+)$/)
      if (req.method === 'GET' && matchGet) {
        const id = matchGet[1]!
        const session = sessions.get(id)
        if (!session) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Session not found' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(session))
        return
      }

      const matchCommand = url.pathname.match(/^\/api\/v1\/setup\/sessions\/([^/]+)\/([^/]+)$/)
      if (req.method === 'POST' && matchCommand) {
        const id = matchCommand[1]!
        const command = matchCommand[2]!
        const session = sessions.get(id)
        if (!session) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Session not found' } }))
          return
        }

        req.resume()
        req.on('end', () => {
          const kindMap: Record<string, string> = {
            discover: 'discovery',
            plan: 'plan',
            diff: 'diff',
            approve: 'approval',
            apply: 'action',
            verify: 'verification',
          }

          if (command === 'resume') {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(session))
            return
          }

          const targetKind = kindMap[command]
          const block = session.blocks.find((candidate) => candidate.kind === targetKind)
          if (block) {
            block.status = 'passed'
            block.value = { output: { executed: command } }
          }
          if (command === 'verify') {
            session.status = 'completed'
            session.currentStage = 'READY'
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(session))
        })
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }))
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr ? addr.port : 3000
        baseUrl = `http://127.0.0.1:${port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    if (previousConfigDir === undefined) delete process.env.NAVIN_CONFIG_DIR
    else process.env.NAVIN_CONFIG_DIR = previousConfigDir
    rmSync(tempConfigDir, { recursive: true, force: true })
  })

  it('renders help and version without network', async () => {
    const help = await runCli(['--help'])
    expect(help.exitCode).toBe(0)
    expect(help.output).toContain('Navin Control CLI')

    const version = await runCli(['--version'])
    expect(version.exitCode).toBe(0)
    expect(version.output).toBe('navin cli 0.1.0')
  })

  it('checks status and runs authentication commands', async () => {
    const status = await runCli(['status'], { apiUrl: baseUrl, token: 'test-token-123' })
    expect(status.exitCode).toBe(0)
    expect(status.output).toContain('Navin daemon is healthy')

    const login = await runCli(['login', 'alice@example.com', 'password123'], {
      apiUrl: baseUrl,
    })
    expect(login.exitCode).toBe(0)
    expect(login.output).toContain('Successfully logged in')

    const whoami = await runCli(['whoami'], { apiUrl: baseUrl, token: 'test-token-123' })
    expect(whoami.exitCode).toBe(0)
    expect(whoami.output).toContain('alice@example.com')
  })

  it('drives setup start, show, blocks, and discover-plan-diff-approve-apply-verify', async () => {
    // 1. Setup start
    const start = await runCli(['setup', 'start', '--title', 'Integration Setup'], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(start.exitCode).toBe(0)
    expect(start.output).toContain('Created setup session set_')

    const sessionId = 'set_0123456789abcdef0123456789abcdef'

    // 2. Setup show
    const show = await runCli(['setup', 'show', sessionId], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(show.exitCode).toBe(0)
    expect(show.output).toContain(sessionId)

    // 3. Setup blocks table
    const blocks = await runCli(['setup', 'blocks', sessionId], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(blocks.exitCode).toBe(0)
    expect(blocks.output).toContain('Discovery Block')
    expect(blocks.output).toContain('Apply Block')

    // 4. Sequential commands
    for (const cmd of ['discover', 'plan', 'diff', 'approve', 'apply', 'verify']) {
      const res = await runCli(['setup', cmd, sessionId], {
        apiUrl: baseUrl,
        token: 'test-token-123',
      })
      expect(res.exitCode).toBe(0)
      if (cmd === 'diff') {
        expect(res.output).toContain('Diff for setup')
      } else {
        expect(res.output).toContain(`Successfully ran ${cmd}`)
      }
    }

    // 5. Setup resume
    const resume = await runCli(['setup', 'resume', sessionId], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(resume.exitCode).toBe(0)
    expect(resume.output).toContain('Resumed setup session')
  })

  it('enforces Tier 3 fail-closed behavior on destructive operations', async () => {
    // Create a destructive setup session
    const start = await runCli(['setup', 'start', '--title', 'Cutover Drill', '--destructive'], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(start.exitCode).toBe(0)

    const sessionId = 'set_0123456789abcdef0123456789abcdef'

    // Approve without confirm fails closed
    const failNoConfirm = await runCli(['setup', 'approve', sessionId], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(failNoConfirm.exitCode).toBe(1)
    expect(failNoConfirm.output).toContain('Tier 3 destructive operation requires confirmation')

    // Approve with --yes but no confirm fails closed (cannot bypass with --yes)
    const failYesBypass = await runCli(['setup', 'approve', sessionId, '--yes'], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(failYesBypass.exitCode).toBe(1)
    expect(failYesBypass.output).toContain('cannot be bypassed with --yes')

    // Approve with wrong phrase fails closed
    const failWrongPhrase = await runCli(['setup', 'approve', sessionId, '--confirm', 'wrong'], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(failWrongPhrase.exitCode).toBe(1)
    expect(failWrongPhrase.output).toContain('confirmation mismatch')

    // Approve with exact confirm phrase succeeds
    const succeed = await runCli(
      ['setup', 'approve', sessionId, '--confirm', `confirm ${sessionId}`],
      {
        apiUrl: baseUrl,
        token: 'test-token-123',
      },
    )
    expect(succeed.exitCode).toBe(0)
    expect(succeed.output).toContain('Successfully ran approve')
  })

  it('supports --json flag across commands', async () => {
    const listJson = await runCli(['setup', 'show', '--json'], {
      apiUrl: baseUrl,
      token: 'test-token-123',
    })
    expect(listJson.exitCode).toBe(0)
    const parsed = JSON.parse(listJson.output)
    expect(Array.isArray(parsed)).toBe(true)
  })
})

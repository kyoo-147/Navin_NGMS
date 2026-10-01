import { fork, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { SHUTDOWN_MESSAGE } from '../../src/main.js'

export const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MAIN_ENTRY = fileURLToPath(new URL('../../src/main.ts', import.meta.url))

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

export interface NavindProcess {
  child: ChildProcess
  port: number
  stdout(): string
  stderr(): string
  shutdown(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  kill(): void
}

export interface StartNavindOptions {
  port: number
  env: Record<string, string>
}

export async function startNavind(options: StartNavindOptions): Promise<NavindProcess> {
  const child = fork(MAIN_ENTRY, [], {
    cwd: APP_ROOT,
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      NAVIN_HOST: '127.0.0.1',
      NAVIN_PORT: String(options.port),
      ...options.env,
    },
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  await Promise.race([
    waitForHttp(`http://127.0.0.1:${options.port}/health`, 20000),
    new Promise<never>((_resolve, reject) => {
      child.once('exit', (code, signal) => {
        reject(
          new Error(
            `navind exited early (code=${code}, signal=${signal})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        )
      })
    }),
  ])

  const logDeadline = Date.now() + 10000
  while (!parseLogRecord(stdout, 'navind listening') && Date.now() < logDeadline) {
    await delay(20)
  }

  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })

  return {
    child,
    port: options.port,
    stdout: () => stdout,
    stderr: () => stderr,
    shutdown: async () => {
      child.send(SHUTDOWN_MESSAGE)
      return waitForExit(child, () => exited, 20000)
    },
    kill: () => {
      child.kill('SIGKILL')
    },
  }
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 503) {
        return response
      }
      lastError = new Error(`status ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

export function waitForExit(
  child: ChildProcess,
  resolver: () => { code: number | null; signal: NodeJS.Signals | null } | undefined,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const existing = resolver()
    if (existing) {
      resolve(existing)
      return
    }
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for child process to exit'))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Finds the most recent structured log record with `msg` in captured stdout. */
export function parseLogRecord(stdout: string, msg: string): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>
      if (record.msg === msg) {
        found = record
      }
    } catch {
      // Ignore partial or non-JSON lines.
    }
  }
  return found
}

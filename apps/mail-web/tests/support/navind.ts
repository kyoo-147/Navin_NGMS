import { fork } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Cross-platform graceful-shutdown message understood by navind over IPC. */
const SHUTDOWN_MESSAGE = 'navind:shutdown'

/**
 * Resolved from the package working directory (pnpm runs each package's test
 * script with cwd set to that package). `import.meta.url` is avoided because
 * the jsdom Vitest runner rewrites it to a non-file URL.
 */
const NAVIND_ROOT = resolve(process.cwd(), '..', 'navind')
const MAIN_ENTRY = join(NAVIND_ROOT, 'src', 'main.ts')

export function createTempDir(prefix = 'mail-web-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup: Windows can hold memory-mapped SQLite files briefly.
  }
}

export function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

export interface NavindProcess {
  port: number
  shutdown(): Promise<{ code: number | null }>
  kill(): void
}

export async function startNavind(options: {
  port: number
  env: Record<string, string>
}): Promise<NavindProcess> {
  const child = fork(MAIN_ENTRY, [], {
    cwd: NAVIND_ROOT,
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      NAVIN_HOST: '127.0.0.1',
      NAVIN_PORT: String(options.port),
      ...options.env,
    },
  })

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  await Promise.race([
    waitForHttp(`http://127.0.0.1:${options.port}/health`, 20000),
    new Promise<never>((_resolve, reject) => {
      child.once('exit', (code, signal) => {
        reject(new Error(`navind exited early (code=${code}, signal=${signal})\n${output}`))
      })
    }),
  ])

  let exited = false
  child.on('exit', () => {
    exited = true
  })

  return {
    port: options.port,
    shutdown: () =>
      new Promise((resolveShutdown) => {
        if (exited) {
          resolveShutdown({ code: null })
          return
        }
        // Never let a stuck child hang a test hook.
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolveShutdown({ code: null })
        }, 10_000)
        child.once('exit', (code) => {
          clearTimeout(timer)
          resolveShutdown({ code })
        })
        try {
          child.send(SHUTDOWN_MESSAGE)
        } catch {
          child.kill('SIGKILL')
        }
      }),
    kill: () => child.kill('SIGKILL'),
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 503) return response
      lastError = new Error(`status ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

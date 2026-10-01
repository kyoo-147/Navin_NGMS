import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CliConfig {
  apiUrl: string
  token?: string
}

export function configDir(): string {
  const base = process.env.NAVIN_CONFIG_DIR || join(homedir(), '.navin')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true, mode: 0o700 })
    try {
      chmodSync(base, 0o700)
    } catch {
      // ignore on platforms where chmod is not supported
    }
  }
  return base
}

export function configFile(): string {
  return join(configDir(), 'cli-session.json')
}

export function loadConfig(urlOverride?: string, tokenOverride?: string): CliConfig {
  const apiUrl = urlOverride || process.env.NAVIN_API_URL || 'http://127.0.0.1:3000'
  let token = tokenOverride || process.env.NAVIN_TOKEN

  if (!token) {
    try {
      const file = configFile()
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { token?: string }
        token = parsed.token
      }
    } catch {
      // ignore read error
    }
  }

  return { apiUrl: apiUrl.replace(/\/+$/, ''), token }
}

export function saveToken(token: string): void {
  const dir = configDir()
  const dest = configFile()
  const tempFile = join(dir, `cli-session.tmp.${process.pid}.${Date.now()}`)
  try {
    writeFileSync(tempFile, JSON.stringify({ token }, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
    try {
      chmodSync(tempFile, 0o600)
    } catch {
      // ignore where not supported
    }
    renameSync(tempFile, dest)
  } catch (error) {
    try {
      if (existsSync(tempFile)) {
        rmSync(tempFile, { force: true })
      }
    } catch {
      // ignore
    }
    throw new Error(
      `Failed to securely persist CLI session token: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function clearToken(): void {
  const file = configFile()
  if (existsSync(file)) {
    rmSync(file, { force: true })
  }
}

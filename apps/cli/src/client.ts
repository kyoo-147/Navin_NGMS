import type { SetupSession, SetupEvent } from '@navin/contracts'
import type { CliConfig } from './config.js'
import { assertSafeApiUrlForToken } from './url-validator.js'

export interface ClientErrorResponse {
  error: {
    code: string
    message: string
    retryable?: boolean
    correlationId?: string
    timestamp?: string
  }
}

export class CliApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(status: number, code: string, message: string, retryable = false) {
    super(`[${code}] ${message}`)
    this.name = 'CliApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

export class NavinCliClient {
  constructor(private readonly config: CliConfig) {
    // Login and step-up carry passwords before a bearer token exists, so the
    // transport policy applies to every request, not only authenticated ones.
    assertSafeApiUrlForToken(config.apiUrl)
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-navin-surface': 'cli',
      ...extra,
    }
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`
    return headers
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.apiUrl}${path}`
    const res = await fetch(url, {
      ...options,
      headers: this.headers((options.headers as Record<string, string>) || {}),
    })

    if (!res.ok) {
      let code = `HTTP_${res.status}`
      let message = res.statusText
      let retryable = res.status >= 500
      try {
        const body = (await res.json()) as ClientErrorResponse
        if (body.error) {
          code = body.error.code
          message = body.error.message
          retryable = Boolean(body.error.retryable)
        }
      } catch {
        // use fallback text
      }
      throw new CliApiError(res.status, code, message, retryable)
    }

    return (await res.json()) as T
  }

  async health(): Promise<{ status: string; service: string; version: string }> {
    return this.request('/health')
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; expiresAt: string; principal?: unknown }> {
    return this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async stepUp(
    password: string,
  ): Promise<{ token: string; assuranceLevel: string; expiresAt: string }> {
    return this.request('/api/v1/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  }

  async whoami(): Promise<{ userId: string; email: string; roles: string[]; scopes: string[] }> {
    return this.request('/api/v1/auth/session')
  }

  async createSetupSession(input: {
    title: string
    intelligenceMode?: string
    targetHost?: unknown
    destructive?: boolean
  }): Promise<SetupSession> {
    return this.request('/api/v1/setup/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async listSetupSessions(): Promise<SetupSession[]> {
    const res = await this.request<{ sessions: SetupSession[] }>('/api/v1/setup/sessions')
    return res.sessions
  }

  async getSetupSession(id: string): Promise<SetupSession> {
    return this.request(`/api/v1/setup/sessions/${encodeURIComponent(id)}`)
  }

  async resumeSetupSession(id: string): Promise<SetupSession> {
    return this.request(`/api/v1/setup/sessions/${encodeURIComponent(id)}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  async runSetupCommand(
    id: string,
    command: 'discover' | 'plan' | 'diff' | 'approve' | 'apply' | 'verify',
    options: { confirmation?: string; force?: boolean } = {},
  ): Promise<SetupSession> {
    return this.request(`/api/v1/setup/sessions/${encodeURIComponent(id)}/${command}`, {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  async streamEvents(
    id: string,
    cursor = 0,
    onEvent: (event: SetupEvent, seq: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/setup/sessions/${encodeURIComponent(id)}/events`
    const res = await fetch(url, {
      headers: this.headers({
        accept: 'text/event-stream',
        'last-event-id': String(cursor),
      }),
      signal,
    })

    if (!res.ok) {
      throw new CliApiError(res.status, `HTTP_${res.status}`, `Failed to connect event stream`)
    }

    if (!res.body) return
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const block of lines) {
          const blockLines = block.split('\n')
          let seq = 0
          let dataText = ''
          for (const line of blockLines) {
            if (line.startsWith('id: ')) {
              seq = Number.parseInt(line.slice(4).trim(), 10) || 0
            } else if (line.startsWith('data: ')) {
              dataText = line.slice(6).trim()
            }
          }
          if (dataText) {
            try {
              const event = JSON.parse(dataText) as SetupEvent
              onEvent(event, seq)
            } catch {
              // ignore malformed event json
            }
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }
}

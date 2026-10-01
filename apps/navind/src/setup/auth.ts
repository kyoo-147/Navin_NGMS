import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import {
  AuthError,
  AuthService,
  CONTROL_SCOPES,
  SqliteAuthStore,
  SystemRandom,
  createControlIssuer,
  createMailIssuer,
  type SessionRecord,
} from '@navin/auth'
import type { Clock } from '../ports/clock.js'

export interface ControlLoginInput {
  email: string
  password: string
  surface: 'control' | 'cli'
}

export class ControlAuthorization {
  private readonly store: SqliteAuthStore
  private readonly service: AuthService

  constructor(
    databasePath: string,
    clock: Clock,
    sessionSecret: string,
    encryptionKey: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.store = new SqliteAuthStore(databasePath)
    const key = createHash('sha256').update(`${sessionSecret}\n${encryptionKey}`).digest()
    this.service = new AuthService({
      store: this.store,
      mailIssuer: createMailIssuer({ key, clock, keyId: 'mail-unused' }),
      controlIssuer: createControlIssuer({ key, clock, keyId: 'control-1' }),
      clock,
      random: new SystemRandom(),
      audit: () => undefined,
    })
    this.ensureBootstrap(env)
  }

  login(input: ControlLoginInput) {
    return this.service.login({
      email: input.email,
      password: input.password,
      relyingParty: 'navin-control',
      surface: input.surface,
    })
  }

  stepUp(input: { sessionId: string; password?: string }) {
    return this.service.stepUp({
      sessionId: input.sessionId,
      password: input.password ?? '',
    })
  }

  authenticate(request: FastifyRequest, requiredScope: string): SessionRecord {
    const token = bearerToken(request.headers.authorization)
    if (!token) throw new AuthError('INVALID_TOKEN')
    const surface = request.headers['x-navin-surface']
    if (surface !== 'control' && surface !== 'cli') {
      throw new AuthError('FORBIDDEN', { reason: 'control_surface_required' })
    }
    const session = this.service.validate({ token, relyingParty: 'navin-control', surface })
    this.service.assertAuthorized(session, {
      relyingParty: 'navin-control',
      surfaces: [surface],
      allOf: [requiredScope],
    })
    return session
  }

  close(): void {
    this.service.close()
  }

  private ensureBootstrap(env: NodeJS.ProcessEnv): void {
    const email = env.NAVIN_CONTROL_BOOTSTRAP_EMAIL?.trim()
    const password = env.NAVIN_CONTROL_BOOTSTRAP_PASSWORD
    if (!email || !password || this.store.getUserByEmail(email)) return
    this.service.createUser({
      email,
      password,
      roles: ['ops.super_admin'],
      displayName: 'Alice',
    })
  }
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value
  if (!header) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1]
}

export function controlScopeFor(method: string, command?: string): string {
  if (method === 'GET') return CONTROL_SCOPES.discover
  switch (command) {
    case 'discover':
    case 'resume':
      return CONTROL_SCOPES.discover
    case 'plan':
    case 'diff':
      return command === 'plan' ? CONTROL_SCOPES.plan : CONTROL_SCOPES.diff
    case 'approve':
      return CONTROL_SCOPES.approve
    case 'apply':
      return CONTROL_SCOPES.apply
    case 'verify':
      return CONTROL_SCOPES.verify
    default:
      return CONTROL_SCOPES.discover
  }
}

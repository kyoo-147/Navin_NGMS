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
  isNavinRole,
  type NavinRole,
  type SessionRecord,
} from '@navin/auth'
import type { Clock } from '../ports/clock.js'

export interface ControlLoginInput {
  email: string
  password: string
  surface: 'control' | 'cli'
}

export class ControlAuthorization {
  readonly store: SqliteAuthStore
  readonly service: AuthService

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
      mailIssuer: createMailIssuer({ key, clock, keyId: 'mail-1' }),
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
    return this.authenticateAll(request, [requiredScope])
  }

  /**
   * Validates the session and requires *every* listed scope. Used where one
   * mutation needs more than one authority (for example apply + approve), so a
   * caller that holds only one of them is rejected before any work begins.
   */
  authenticateAll(request: FastifyRequest, requiredScopes: readonly string[]): SessionRecord {
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
      allOf: [...requiredScopes],
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
    const role = bootstrapRole(env)
    this.service.createUser({
      email,
      password,
      roles: [role],
      displayName: 'Alice',
    })
  }
}

/**
 * Bootstrap role, defaulting to the full administrator. A least-privilege role
 * (for example `ops.operator`) can be selected for disposable acceptance so the
 * separation of apply and approve authority is exercisable in a real process.
 */
export function bootstrapRole(env: NodeJS.ProcessEnv): NavinRole {
  const raw = env.NAVIN_CONTROL_BOOTSTRAP_ROLE?.trim()
  if (raw === undefined || raw.length === 0) {
    return 'ops.super_admin'
  }
  if (!isNavinRole(raw)) {
    throw new Error(`NAVIN_CONTROL_BOOTSTRAP_ROLE is not a known Navin role: ${raw}`)
  }
  return raw
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

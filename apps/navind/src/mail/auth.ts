import type { FastifyRequest } from 'fastify'
import {
  AuthError,
  AuthService,
  buildClearedSessionCookie,
  isAuthError,
  sessionCookiePolicyFor,
  type SessionRecord,
} from '@navin/auth'

export interface MailLoginInput {
  email: string
  password: string
}

export interface MailAuthorizationOptions {
  /** Environment used only for the optional local bootstrap account. */
  env?: NodeJS.ProcessEnv
  /** Never true in production: local mailbox bootstrap is a development aid. */
  allowBootstrap?: boolean
}

const MAIL_SURFACE = 'mail'
const MAIL_RELYING_PARTY = 'navin-mail'

/**
 * Mail-surface authorization.
 *
 * Mail and Control share one identity authority and signing key but use
 * separate relying parties, audiences and host-only sessions. A Mail request is
 * accepted only with a `navin-mail` token (host-only cookie or bearer) and the
 * `mail` surface, so a Control credential can never be replayed against Mail.
 */
export class MailAuthorization {
  constructor(
    private readonly service: AuthService,
    options: MailAuthorizationOptions = {},
  ) {
    if (options.allowBootstrap === false) return
    this.ensureBootstrap(options.env ?? process.env)
  }

  login(input: MailLoginInput) {
    return this.service.login({
      email: input.email,
      password: input.password,
      relyingParty: MAIL_RELYING_PARTY,
      surface: MAIL_SURFACE,
    })
  }

  authenticate(request: FastifyRequest, requiredScope: string): SessionRecord {
    const surface = request.headers['x-navin-surface']
    if (surface !== MAIL_SURFACE) {
      throw new AuthError('FORBIDDEN', { reason: 'mail_surface_required' })
    }
    const token = bearerToken(request.headers.authorization) ?? mailSessionCookie(request)
    if (!token) throw new AuthError('INVALID_TOKEN')
    const session = this.service.validate({
      token,
      relyingParty: MAIL_RELYING_PARTY,
      surface: MAIL_SURFACE,
    })
    this.service.assertAuthorized(session, {
      relyingParty: MAIL_RELYING_PARTY,
      surfaces: [MAIL_SURFACE],
      allOf: [requiredScope],
    })
    return session
  }

  /** Revokes the session and returns the Set-Cookie value that clears it. */
  logout(session: SessionRecord): string {
    this.service.revoke(session.sessionId)
    return buildClearedSessionCookie(sessionCookiePolicyFor(MAIL_RELYING_PARTY))
  }

  private ensureBootstrap(env: NodeJS.ProcessEnv): void {
    const email = env.NAVIN_MAIL_BOOTSTRAP_EMAIL?.trim()
    const password = env.NAVIN_MAIL_BOOTSTRAP_PASSWORD
    if (!email || !password) return
    try {
      this.service.createUser({
        email,
        password,
        roles: ['mail.user'],
        displayName: 'Alice',
      })
    } catch (error) {
      if (isAuthError(error) && error.code === 'EMAIL_IN_USE') return
      throw error
    }
  }
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value
  if (!header) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1]
}

function mailSessionCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie
  if (!header) return undefined
  const name = sessionCookiePolicyFor(MAIL_RELYING_PARTY).name
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return undefined
}

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigValidationError,
  DEV_ENCRYPTION_KEY,
  DEV_SESSION_SECRET,
  loadConfig,
  redactConfig,
} from '../src/config/config.js'
import { REDACTED } from '../src/logging/redact.js'

const STRONG_SECRETS = {
  NAVIN_SESSION_SECRET: 'session-secret-that-is-strong-enough',
  NAVIN_ENCRYPTION_KEY: 'encryption-key-that-is-strong-enough',
}

describe('config loading', () => {
  it('applies development defaults and never returns unknown keys', () => {
    const config = loadConfig({ env: {} })

    expect(config.environment).toBe('development')
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(8080)
    expect(config.logLevel).toBe('info')
    expect(config.trustProxy).toBe(false)
    expect(config.bodyLimitBytes).toBe(1048576)
    expect(config.shutdownTimeoutMs).toBe(10000)
    expect(config.dataDir).toBe('./data')
    expect(config.databasePath).toBe(join('./data', 'navin.db'))
    expect(config.secrets.sessionSecret).toBe(DEV_SESSION_SECRET)
    expect(config.secrets.encryptionKey).toBe(DEV_ENCRYPTION_KEY)
  })

  it('parses environment variables and derives the database path', () => {
    const config = loadConfig({
      env: {
        NAVIN_ENVIRONMENT: 'test',
        NAVIN_HOST: '0.0.0.0',
        NAVIN_PORT: '9000',
        NAVIN_LOG_LEVEL: 'debug',
        NAVIN_TRUST_PROXY: 'true',
        NAVIN_DATA_DIR: '/var/lib/navin',
        ...STRONG_SECRETS,
      },
    })

    expect(config.environment).toBe('test')
    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(9000)
    expect(config.logLevel).toBe('debug')
    expect(config.trustProxy).toBe(true)
    expect(config.databasePath).toBe(join('/var/lib/navin', 'navin.db'))
  })

  it('rejects non-numeric and out-of-range ports', () => {
    expect(() => loadConfig({ env: { NAVIN_PORT: 'not-a-number' } })).toThrow(ConfigValidationError)
    expect(() => loadConfig({ env: { NAVIN_PORT: '70000' } })).toThrow(ConfigValidationError)
  })

  it('rejects invalid environment and boolean values', () => {
    expect(() => loadConfig({ env: { NAVIN_ENVIRONMENT: 'staging' } })).toThrow(
      ConfigValidationError,
    )
    expect(() => loadConfig({ env: { NAVIN_TRUST_PROXY: 'maybe' } })).toThrow(ConfigValidationError)
  })

  it('reports structured issues', () => {
    try {
      loadConfig({ env: { NAVIN_PORT: 'abc' } })
      expect.unreachable('expected loadConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError)
      const issues = (error as ConfigValidationError).issues
      expect(issues.some((issue) => issue.path === 'NAVIN_PORT')).toBe(true)
    }
  })

  it('requires real secrets in production', () => {
    expect(() => loadConfig({ env: { NAVIN_ENVIRONMENT: 'production' } })).toThrow(
      ConfigValidationError,
    )
    expect(() =>
      loadConfig({
        env: {
          NAVIN_ENVIRONMENT: 'production',
          NAVIN_SESSION_SECRET: DEV_SESSION_SECRET,
          NAVIN_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
        },
      }),
    ).toThrow(ConfigValidationError)
  })

  it('accepts production with strong secrets', () => {
    const config = loadConfig({ env: { NAVIN_ENVIRONMENT: 'production', ...STRONG_SECRETS } })
    expect(config.environment).toBe('production')
  })

  it('applies overrides after environment parsing', () => {
    const config = loadConfig({ env: {}, overrides: { port: 1234, logLevel: 'warn' } })
    expect(config.port).toBe(1234)
    expect(config.logLevel).toBe('warn')
  })
})

describe('config hardening', () => {
  it('rejects production selected via overrides without production secrets', () => {
    expect(() => loadConfig({ env: {}, overrides: { environment: 'production' } })).toThrow(
      ConfigValidationError,
    )
  })

  it('rejects development placeholder secrets when production is selected via overrides', () => {
    expect(() =>
      loadConfig({
        env: {},
        overrides: {
          environment: 'production',
          secrets: { sessionSecret: DEV_SESSION_SECRET, encryptionKey: DEV_ENCRYPTION_KEY },
        },
      }),
    ).toThrow(ConfigValidationError)
  })

  it('accepts production selected via overrides when real secrets are supplied', () => {
    const config = loadConfig({
      env: {},
      overrides: {
        environment: 'production',
        secrets: {
          sessionSecret: 'overridden-strong-session-secret',
          encryptionKey: 'overridden-strong-encryption-key',
        },
      },
    })

    expect(config.environment).toBe('production')
    expect(config.secrets.sessionSecret).toBe('overridden-strong-session-secret')
  })

  it('deep-freezes the returned configuration', () => {
    const config = loadConfig({ env: {} })

    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.secrets)).toBe(true)
    expect(() => {
      ;(config as { port: number }).port = 1
    }).toThrow()
    expect(() => {
      ;(config.secrets as { sessionSecret: string }).sessionSecret = 'mutated'
    }).toThrow()
  })
})

describe('config redaction', () => {
  it('masks every secret while keeping the shape', () => {
    const config = loadConfig({ env: STRONG_SECRETS })
    const redacted = redactConfig(config)

    expect(redacted.secrets.sessionSecret).toBe(REDACTED)
    expect(redacted.secrets.encryptionKey).toBe(REDACTED)
    expect(redacted.port).toBe(config.port)
    expect(JSON.stringify(redacted)).not.toContain(STRONG_SECRETS.NAVIN_SESSION_SECRET)
    expect(Object.isFrozen(redacted)).toBe(true)
  })
})

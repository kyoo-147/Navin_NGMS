import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { redactConfig } from '../config/config.js'
import { MetadataStore } from '../db/metadata-store.js'
import { KERNEL_MIGRATIONS } from '../db/migrations.js'
import { Migrator } from '../db/migrator.js'
import { createDatabaseCheck, createMigrationsCheck } from '../health/checks.js'
import { DefaultHealthRegistry } from '../health/registry.js'
import { buildServer } from '../http/server.js'
import { ControlAuthorization } from '../setup/auth.js'
import { MailAuthorization } from '../mail/auth.js'
import { MailService } from '../mail/service.js'
import type { MailAccountBinding } from '../mail/credentials.js'
import type { MailConfig } from '../config/schema.js'
import { SetupService } from '@navin/setup-core'
import { ActionCore } from '@navin/action-core'
import { OrganizationService } from '@navin/organization-core'
import { buildEngineAdapter } from '../organization/engine.js'
import type { Database } from '../ports/database.js'
import type { Container } from './container.js'

export interface KernelStartResult {
  host: string
  port: number
  url: string
}

export interface KernelBootInfo {
  bootCount: number
  migrationsApplied: number
}

/**
 * Owns the runtime lifecycle of the daemon.
 *
 * `start()` opens the database, runs migrations, records the boot, wires
 * health checks and starts the HTTP server. `stop()` reverses that order and
 * is idempotent, so signal handlers, IPC control and tests can all call it
 * safely.
 */
export class NavinKernel {
  private readonly container: Container
  private server: FastifyInstance | undefined
  private database: Database | undefined
  private core: ActionCore | undefined
  private auth: ControlAuthorization | undefined
  private mail: MailService | undefined
  private started = false
  private stopPromise: Promise<void> | undefined

  constructor(container: Container) {
    this.container = container
  }

  get isStarted(): boolean {
    return this.started
  }

  get fastify(): FastifyInstance | undefined {
    return this.server
  }

  async start(): Promise<KernelStartResult> {
    if (this.started) {
      throw new Error('Kernel is already started')
    }

    const { config, clock, ids, logger, databaseFactory } = this.container
    const startedAt = Date.now()

    logger.info('starting navind', { config: redactConfig(config) })

    if (config.databasePath !== ':memory:') {
      mkdirSync(dirname(config.databasePath), { recursive: true })
    }

    const database = databaseFactory.open({
      path: config.databasePath,
      timeoutMs: Math.min(config.shutdownTimeoutMs, 5000),
    })
    this.database = database

    let bootInfo: KernelBootInfo | undefined

    try {
      const migrator = new Migrator(database, KERNEL_MIGRATIONS, clock)
      const migrationResult = migrator.migrate()
      logger.info('migrations applied', {
        applied: migrationResult.applied,
        total: migrationResult.total,
      })

      const metadata = new MetadataStore(database, clock)
      const boot = metadata.recordBoot()
      bootInfo = { bootCount: boot.bootCount, migrationsApplied: migrationResult.total }

      const health = new DefaultHealthRegistry(clock)
      health.register(createDatabaseCheck(database))
      health.register(createMigrationsCheck(migrator))

      const setup = new SetupService(database, clock)
      const auth = new ControlAuthorization(
        database.path,
        clock,
        config.secrets.sessionSecret,
        config.secrets.encryptionKey,
      )
      this.auth = auth

      // The action ledger runs its own migrations on its own SQLite file so its
      // `schema_migrations` table never collides with the kernel migrator.
      const actionDatabasePath =
        config.databasePath === ':memory:' ? ':memory:' : `${config.databasePath}.actions`
      const core = ActionCore.open({ path: actionDatabasePath, clock: () => clock.now() })
      this.core = core

      const recoveredActions = core.actionService.recoverInterrupted()
      const recoveredJobs = core.jobRunner.recoverInterrupted()
      if (recoveredActions.length > 0 || recoveredJobs.length > 0) {
        logger.warn('recovered interrupted action work', {
          actions: recoveredActions.length,
          jobs: recoveredJobs.length,
        })
      }

      const engine = buildEngineAdapter(config.engine)
      logger.info('organization engine binding', {
        configured: engine !== null,
        engine: engine?.descriptor.engineId ?? null,
      })
      const organization = new OrganizationService({
        core,
        engine,
        clock: () => clock.now(),
      })

      const mailAccount = mailAccountFromConfig(config.mail)
      const mail = new MailService({
        databasePath: config.databasePath,
        clock,
        sessions: auth.store,
        account: mailAccount,
        sender:
          mailAccount && config.mail.senderIdentityId
            ? { identityId: config.mail.senderIdentityId, address: mailAccount.email }
            : null,
      })
      this.mail = mail
      const mailAuth = new MailAuthorization(auth.service, {
        env: process.env,
        allowBootstrap: config.environment !== 'production',
      })

      const server = buildServer({
        config,
        clock,
        ids,
        logger,
        health,
        startedAt,
        setup,
        auth,
        organization,
        mail,
        mailAuth,
      })
      this.server = server
      await server.listen({ host: config.host, port: config.port })
    } catch (error) {
      await this.stop()
      throw error
    }

    const address = this.server?.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.port
    this.started = true

    logger.info('navind listening', {
      host: config.host,
      port,
      url: `http://${config.host}:${port}`,
      bootCount: bootInfo?.bootCount,
      migrationsApplied: bootInfo?.migrationsApplied,
    })

    return { host: config.host, port, url: `http://${config.host}:${port}` }
  }

  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise
    }
    if (!this.started && !this.server && !this.database) {
      return Promise.resolve()
    }
    this.stopPromise = this.performStop()
    return this.stopPromise
  }

  private async performStop(): Promise<void> {
    const { logger } = this.container
    logger.info('stopping navind')

    const server = this.server
    this.server = undefined
    if (server) {
      try {
        await server.close()
      } catch (error) {
        logger.error('failed to close http server', { err: error })
      }
    }

    if (this.mail) {
      try {
        this.mail.close()
      } catch (error) {
        logger.error('failed to close mail service', { err: error })
      }
      this.mail = undefined
    }

    if (this.auth) {
      try {
        this.auth.close()
      } catch (error) {
        logger.error('failed to close auth store', { err: error })
      }
      this.auth = undefined
    }

    const core = this.core
    this.core = undefined
    if (core) {
      try {
        core.close()
      } catch (error) {
        logger.error('failed to close action ledger', { err: error })
      }
    }

    const database = this.database
    this.database = undefined
    if (database) {
      try {
        database.close()
      } catch (error) {
        logger.error('failed to close database', { err: error })
      }
    }

    this.started = false
    logger.info('navind stopped')
  }
}

/**
 * A complete upstream binding enables the Mail BFF; an incomplete or absent
 * binding leaves it disabled so every Mail endpoint fails closed.
 */
function mailAccountFromConfig(mail: MailConfig): MailAccountBinding | null {
  if (mail.jmapSessionUrl && mail.jmapAuthorization && mail.accountEmail) {
    return {
      sessionUrl: mail.jmapSessionUrl,
      authorization: mail.jmapAuthorization,
      email: mail.accountEmail,
    }
  }
  return null
}

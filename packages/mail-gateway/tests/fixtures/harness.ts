import { MailGateway, type MailGatewayContext } from '../../src/gateway.js'
import { InMemoryIdempotencyStore } from '../../src/idempotency/store.js'
import { InMemoryCredentialProvider, basicAuthorization } from '../../src/credentials/provider.js'
import { encodeId } from '../../src/mapping/id.js'
import { startJmapFixture, type FixtureOptions, type JmapFixture } from './jmap-fixture.js'

export interface GatewayHarness {
  gateway: MailGateway
  fixture: JmapFixture
  credentials: InMemoryCredentialProvider
  authorization: string
  sessionId: string
  accountId: string
  ctx: MailGatewayContext
  close: () => Promise<void>
}

export interface HarnessOptions extends FixtureOptions {
  sessionId?: string
  seedCredential?: string
}

export async function createHarness(options: HarnessOptions = {}): Promise<GatewayHarness> {
  const authorization = options.authorization ?? basicAuthorization('user@example.org', 'secret')
  const fixture = await startJmapFixture({ ...options, authorization })
  const sessionId = options.sessionId ?? 'sess-test'
  const credentials = new InMemoryCredentialProvider()
  credentials.set(sessionId, {
    sessionUrl: fixture.sessionUrl,
    authorization: options.seedCredential ?? authorization,
  })
  const gateway = new MailGateway({
    credentials,
    idempotency: new InMemoryIdempotencyStore(),
    sessionTtlMs: 0,
  })
  return {
    gateway,
    fixture,
    credentials,
    authorization,
    sessionId,
    accountId: encodeId('acc', fixture.accountId),
    ctx: { sessionId, requestId: 'req-test' },
    close: () => fixture.stop(),
  }
}

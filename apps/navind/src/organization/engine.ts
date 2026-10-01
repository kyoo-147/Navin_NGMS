import { StalwartEngineAdapter, type MailEngineAdapter } from '@navin/engine-core'
import type { EngineConfig } from '../config/schema.js'

/**
 * Builds the real Stalwart admin adapter from configuration.
 *
 * Returns `null` when the binding is incomplete so organization actions fail
 * closed with a typed `SERVICE_UNAVAILABLE` rather than a memory-only success.
 */
export function buildEngineAdapter(engine: EngineConfig): MailEngineAdapter | null {
  if (engine.endpoint === null) {
    return null
  }
  const hasToken = engine.token !== null
  const hasBasic = engine.username !== null && engine.password !== null
  if (!hasToken && !hasBasic) {
    return null
  }
  return new StalwartEngineAdapter({
    endpoint: engine.endpoint,
    allowInsecureHttp: engine.allowInsecureHttp,
    ...(hasToken ? { token: engine.token as string } : {}),
    ...(hasBasic
      ? { username: engine.username as string, password: engine.password as string }
      : {}),
  })
}

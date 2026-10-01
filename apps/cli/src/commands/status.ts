import type { NavinCliClient } from '../client.js'

export async function handleStatusCommand(
  client: NavinCliClient,
  flags: { json?: boolean },
): Promise<{ output: string; exitCode: number }> {
  try {
    const health = await client.health()
    if (flags.json) return { output: JSON.stringify(health, null, 2), exitCode: 0 }
    return {
      output: `Navin daemon is healthy.\nService: ${health.service}\nVersion: ${health.version}\nStatus:  ${health.status}`,
      exitCode: 0,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { output: `Navin daemon is unreachable or error: ${msg}`, exitCode: 1 }
  }
}

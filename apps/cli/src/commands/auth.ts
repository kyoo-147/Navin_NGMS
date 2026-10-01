import type { NavinCliClient } from '../client.js'
import { clearToken, saveToken } from '../config.js'

export async function handleAuthCommand(
  client: NavinCliClient,
  action: string,
  args: string[],
  flags: { email?: string; password?: string; json?: boolean },
): Promise<{ output: string; exitCode: number }> {
  switch (action) {
    case 'login': {
      const email = flags.email || args[0]
      const password = flags.password || args[1]
      if (!email || !password) {
        return {
          output: 'Error: Email and password required. Usage: navin login <email> <password>',
          exitCode: 1,
        }
      }
      const result = await client.login(email, password)
      try {
        saveToken(result.token)
      } catch (error) {
        return {
          output: `Error: Login succeeded on daemon, but persisting token locally failed: ${error instanceof Error ? error.message : String(error)}`,
          exitCode: 1,
        }
      }
      if (flags.json) return { output: JSON.stringify(result, null, 2), exitCode: 0 }
      return { output: `Successfully logged in as ${email}. Session token saved.`, exitCode: 0 }
    }

    case 'logout': {
      clearToken()
      return { output: 'Logged out. Removed stored token.', exitCode: 0 }
    }

    case 'whoami': {
      const info = await client.whoami()
      if (flags.json) return { output: JSON.stringify(info, null, 2), exitCode: 0 }
      return {
        output: `User ID: ${info.userId}\nEmail:   ${info.email}\nRoles:   ${info.roles.join(', ')}\nScopes:  ${info.scopes.join(', ')}`,
        exitCode: 0,
      }
    }

    case 'step-up': {
      const password = flags.password || args[0]
      if (!password) {
        return {
          output: 'Error: Password required for step-up. Usage: navin step-up <password>',
          exitCode: 1,
        }
      }
      const result = await client.stepUp(password)
      try {
        saveToken(result.token)
      } catch (error) {
        return {
          output: `Error: Step-up verified on daemon, but persisting token locally failed: ${error instanceof Error ? error.message : String(error)}`,
          exitCode: 1,
        }
      }
      if (flags.json) return { output: JSON.stringify(result, null, 2), exitCode: 0 }
      return {
        output: `Step-up authentication verified. Assurance level: ${result.assuranceLevel}`,
        exitCode: 0,
      }
    }

    default:
      return { output: `Unknown auth action: ${action}`, exitCode: 1 }
  }
}

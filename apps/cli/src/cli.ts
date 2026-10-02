import { NavinCliClient } from './client.js'
import { handleAliasCommand } from './commands/alias.js'
import { handleAuthCommand } from './commands/auth.js'
import { handleDomainCommand } from './commands/domain.js'
import { handleMailboxCommand } from './commands/mailbox.js'
import { handleSetupCommand } from './commands/setup.js'
import { handleStatusCommand } from './commands/status.js'
import { loadConfig } from './config.js'

export interface ParsedArgs {
  namespace: string
  action: string
  args: string[]
  flags: {
    json?: boolean
    url?: string
    token?: string
    title?: string
    target?: string
    address?: string
    name?: string
    email?: string
    /** Resolved apply-time password (from --password-stdin), never from argv. */
    password?: string
    passwordStdin?: boolean
    /** Set when the removed plaintext --password flag is used. */
    plaintextPassword?: boolean
    description?: string
    idempotencyKey?: string
    destructive?: boolean
    confirm?: string
    yes?: boolean
    cursor?: number
    help?: boolean
    version?: boolean
  }
}

export function parseArgs(rawArgs: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = {}
  const positional: string[] = []

  let i = 0
  while (i < rawArgs.length) {
    const arg = rawArgs[i] ?? ''
    if (arg === '--json') {
      flags.json = true
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true
    } else if (arg === '--destructive') {
      flags.destructive = true
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true
    } else if (arg === '--url' && i + 1 < rawArgs.length) {
      flags.url = rawArgs[++i]
    } else if (arg === '--token' && i + 1 < rawArgs.length) {
      flags.token = rawArgs[++i]
    } else if (arg === '--title' && i + 1 < rawArgs.length) {
      flags.title = rawArgs[++i]
    } else if (arg === '--target' && i + 1 < rawArgs.length) {
      flags.target = rawArgs[++i]
    } else if (arg === '--address' && i + 1 < rawArgs.length) {
      flags.address = rawArgs[++i]
    } else if (arg === '--name' && i + 1 < rawArgs.length) {
      flags.name = rawArgs[++i]
    } else if (arg === '--email' && i + 1 < rawArgs.length) {
      flags.email = rawArgs[++i]
    } else if (arg === '--password-stdin') {
      flags.passwordStdin = true
    } else if (arg === '--password') {
      // Plaintext secrets must never enter process argv or shell history. The
      // value is skipped so it cannot be mistaken for a positional argument.
      flags.plaintextPassword = true
      const next = rawArgs[i + 1]
      if (next !== undefined && !next.startsWith('--')) i++
    } else if (arg === '--description' && i + 1 < rawArgs.length) {
      flags.description = rawArgs[++i]
    } else if (arg === '--idempotency-key' && i + 1 < rawArgs.length) {
      flags.idempotencyKey = rawArgs[++i]
    } else if (arg === '--confirm' && i + 1 < rawArgs.length) {
      flags.confirm = rawArgs[++i]
    } else if (arg === '--cursor' && i + 1 < rawArgs.length) {
      flags.cursor = Number.parseInt(rawArgs[++i] ?? '0', 10)
    } else if (!arg.startsWith('--')) {
      positional.push(arg)
    }
    i++
  }

  const first = positional[0] || 'help'
  if (['login', 'logout', 'whoami', 'step-up'].includes(first)) {
    return {
      namespace: 'auth',
      action: first,
      args: positional.slice(1),
      flags,
    }
  }

  if (first === 'status') {
    return {
      namespace: 'status',
      action: 'status',
      args: positional.slice(1),
      flags,
    }
  }

  return {
    namespace: first,
    action: positional[1] || 'show',
    args: positional.slice(2),
    flags,
  }
}

/**
 * Explicit IO boundary. The executable entrypoint supplies the stdin reader;
 * tests inject a deterministic one. It is never read unless `--password-stdin`
 * is present, so a plain invocation can never block on stdin.
 */
export interface CliIo {
  readPasswordFromStdin: () => Promise<string>
}

export async function runCli(
  rawArgs: string[],
  configOverrides?: { apiUrl?: string; token?: string },
  io?: CliIo,
): Promise<{ output: string; exitCode: number }> {
  const parsed = parseArgs(rawArgs)

  if (parsed.flags.version) {
    return { output: 'navin cli 0.1.0', exitCode: 0 }
  }

  if (parsed.flags.help || parsed.namespace === 'help') {
    const help = `Navin Control CLI — Phase 1 terminal client

Usage:
  navin status                                Check daemon status
  navin login <email> <password>              Authenticate session
  navin logout                                Clear session
  navin whoami                                Show current session
  navin step-up <password>                    Elevate to recent authentication for Tier 3
  navin setup start [--title <name>]          Start new setup session
  navin setup show [sessionId]                Show session summary
  navin setup blocks <sessionId>              List setup blocks
  navin setup resume <sessionId>              Resume session
  navin setup discover <sessionId>            Run discovery stage
  navin setup plan <sessionId>                Generate setup plan
  navin setup diff <sessionId>                Review exact changes
  navin setup approve <sessionId> [--confirm] Record setup approval
  navin setup apply <sessionId>               Apply mutations
  navin setup verify <sessionId>              Verify applied state
  navin setup evidence <sessionId> [id]       Inspect evidence
  navin setup events <sessionId>              Listen to SSE events
  navin alias plan --address <a> --target <t> Plan a reversible alias (no mutation)
  navin alias create --address <a> --target <t> [--yes] [--idempotency-key <k>]
                                              Provision the alias (Tier 1, requires --yes)
  navin alias status <actionId>               Show action, attempts, job and evidence
  navin alias rollback <actionId>             Remove the alias this action created
  navin domain plan --name <domain>           Plan a reversible domain (no mutation)
  navin domain create --name <domain> [--yes] [--idempotency-key <k>]
                                              Provision the domain (Tier 1, requires --yes)
  navin domain status <actionId>              Show action, attempts, job and evidence
  navin domain rollback <actionId>            Remove the domain this action created
  navin mailbox plan --email <address>        Plan a reversible mailbox (no mutation)
  navin mailbox create --email <address> --password-stdin [--yes] [--idempotency-key <k>]
                                              Provision the mailbox (Tier 1, requires --yes; reads the
                                              password from stdin)
  navin mailbox status <actionId>             Show action, attempts, job and evidence
  navin mailbox rollback <actionId> --confirm <email>
                                              Destroy the mailbox (Tier 3, recent step-up + typed email)

Options:
  --json           Output raw JSON
  --url <url>      Override navind URL (default: http://127.0.0.1:3000)
  --token <token>  Override session bearer token
  --address <a>    Alias address for organization alias actions
  --target <t>     Alias destination address
  --name <domain>  Domain name for organization domain actions
  --email <address>  Mailbox address for organization mailbox actions
  --password-stdin  Read the apply-time mailbox password from stdin (never argv)
  --description <d>  Optional resource description
  --idempotency-key <k>  Stable key so a retry resumes instead of duplicating
  --confirm <str>  Typed confirmation for Tier 3 operations
  --yes            Confirm a Tier 1 reversible mutation (never bypasses Tier 3)
`
    return { output: help.trim(), exitCode: 0 }
  }

  if (parsed.flags.plaintextPassword) {
    return {
      output:
        'Error: plaintext --password is not supported (it would leak the secret into shell history and process argv).\nPipe the secret via --password-stdin instead.',
      exitCode: 1,
    }
  }

  if (parsed.flags.passwordStdin) {
    if (io === undefined) {
      return {
        output: 'Error: --password-stdin cannot be read in this context.',
        exitCode: 1,
      }
    }
    try {
      parsed.flags.password = await io.readPasswordFromStdin()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { output: `Error: ${message}`, exitCode: 1 }
    }
  }

  const config = loadConfig(
    configOverrides?.apiUrl || parsed.flags.url,
    configOverrides?.token || parsed.flags.token,
  )
  const client = new NavinCliClient(config)

  try {
    switch (parsed.namespace) {
      case 'status':
        return await handleStatusCommand(client, parsed.flags)
      case 'auth':
        return await handleAuthCommand(client, parsed.action, parsed.args, parsed.flags)
      case 'setup':
        return await handleSetupCommand(client, parsed.action, parsed.args, parsed.flags)
      case 'alias':
        return await handleAliasCommand(client, parsed.action, parsed.args, parsed.flags)
      case 'domain':
        return await handleDomainCommand(client, parsed.action, parsed.args, parsed.flags)
      case 'mailbox':
        return await handleMailboxCommand(client, parsed.action, parsed.args, parsed.flags)
      default:
        return {
          output: `Unknown command "${parsed.namespace}". Run "navin --help" for usage.`,
          exitCode: 1,
        }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { output: `Error: ${msg}`, exitCode: 1 }
  }
}

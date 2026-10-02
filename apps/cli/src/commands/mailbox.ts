import type { NavinCliClient } from '../client.js'
import { formatMailboxActionView } from '../format.js'

export interface MailboxCommandFlags {
  email?: string
  password?: string
  description?: string
  idempotencyKey?: string
  confirm?: string
  yes?: boolean
  json?: boolean
}

export async function handleMailboxCommand(
  client: NavinCliClient,
  action: string,
  args: string[],
  flags: MailboxCommandFlags,
): Promise<{ output: string; exitCode: number }> {
  switch (action) {
    case 'plan': {
      const email = flags.email ?? args[0]
      if (!email) {
        return {
          output: 'Error: --email is required. Usage: navin mailbox plan --email <address>',
          exitCode: 1,
        }
      }
      const view = await client.planMailbox({
        email,
        ...(flags.description === undefined ? {} : { description: flags.description }),
        ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
      })
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Planned mailbox action ${view.action.id}\n\n${formatMailboxActionView(view)}`,
        exitCode: 0,
      }
    }

    case 'create': {
      const email = flags.email ?? args[0]
      if (!email) {
        return {
          output:
            'Error: --email is required. Usage: navin mailbox create --email <address> --password-stdin --yes',
          exitCode: 1,
        }
      }
      // Non-interactive fail-closed: a Tier 1 mutation is never applied without
      // an explicit confirmation flag.
      if (!flags.yes) {
        return {
          output:
            'Error: Tier 1 mailbox provisioning requires explicit confirmation.\nRe-run with --yes (non-interactive callers fail closed).',
          exitCode: 1,
        }
      }
      // The password is an apply-time secret and is required to create a mailbox
      // with a login. It is read from stdin via --password-stdin (never argv) and
      // passed in the request body only.
      if (!flags.password) {
        return {
          output:
            'Error: --password-stdin is required to create a mailbox (the password is never taken from argv).\nUsage: navin mailbox create --email <address> --password-stdin --yes',
          exitCode: 1,
        }
      }
      const view = await client.createMailbox(
        {
          email,
          password: flags.password,
          confirm: true,
          ...(flags.description === undefined ? {} : { description: flags.description }),
          ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
        },
        flags.idempotencyKey,
      )
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Mailbox action ${view.action.id} is ${view.action.status}\n\n${formatMailboxActionView(view)}`,
        exitCode: view.action.status === 'completed' ? 0 : 1,
      }
    }

    case 'status': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output: 'Error: Action ID required. Usage: navin mailbox status <actionId>',
          exitCode: 1,
        }
      }
      const view = await client.getMailboxAction(actionId)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return { output: formatMailboxActionView(view), exitCode: 0 }
    }

    case 'rollback': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output:
            'Error: Action ID required. Usage: navin mailbox rollback <actionId> --confirm <mailbox-email>',
          exitCode: 1,
        }
      }
      // Destructive Tier 3: `--yes` is never a substitute for the typed
      // confirmation, and omitting the address fails closed.
      if (flags.yes && flags.confirm === undefined) {
        return {
          output:
            'Error: Tier 3 mailbox rollback cannot be bypassed with --yes. Provide --confirm <mailbox-email>.',
          exitCode: 1,
        }
      }
      if (flags.confirm === undefined) {
        return {
          output:
            'Error: Tier 3 mailbox rollback requires typed confirmation.\nRe-run with --confirm <mailbox-email>.',
          exitCode: 1,
        }
      }
      const view = await client.rollbackMailbox(actionId, flags.confirm)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Mailbox action ${view.action.id} is ${view.action.status}\n\n${formatMailboxActionView(view)}`,
        exitCode: view.action.status === 'rolled_back' ? 0 : 1,
      }
    }

    default:
      return {
        output: `Unknown mailbox command: "${action}". Available commands: plan, create, status, rollback.`,
        exitCode: 1,
      }
  }
}

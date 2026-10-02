import type { NavinCliClient } from '../client.js'
import { formatDomainActionView } from '../format.js'

export interface DomainCommandFlags {
  name?: string
  description?: string
  idempotencyKey?: string
  yes?: boolean
  json?: boolean
}

export async function handleDomainCommand(
  client: NavinCliClient,
  action: string,
  args: string[],
  flags: DomainCommandFlags,
): Promise<{ output: string; exitCode: number }> {
  switch (action) {
    case 'plan': {
      const name = flags.name ?? args[0]
      if (!name) {
        return {
          output: 'Error: --name is required. Usage: navin domain plan --name <domain>',
          exitCode: 1,
        }
      }
      const view = await client.planDomain({
        name,
        ...(flags.description === undefined ? {} : { description: flags.description }),
        ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
      })
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Planned domain action ${view.action.id}\n\n${formatDomainActionView(view)}`,
        exitCode: 0,
      }
    }

    case 'create': {
      const name = flags.name ?? args[0]
      if (!name) {
        return {
          output: 'Error: --name is required. Usage: navin domain create --name <domain> --yes',
          exitCode: 1,
        }
      }
      // Non-interactive fail-closed: a Tier 1 mutation is never applied without
      // an explicit confirmation flag. The daemon enforces the same rule.
      if (!flags.yes) {
        return {
          output:
            'Error: Tier 1 domain provisioning requires explicit confirmation.\nRe-run with --yes (non-interactive callers fail closed).',
          exitCode: 1,
        }
      }
      const view = await client.createDomain(
        {
          name,
          confirm: true,
          ...(flags.description === undefined ? {} : { description: flags.description }),
          ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
        },
        flags.idempotencyKey,
      )
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Domain action ${view.action.id} is ${view.action.status}\n\n${formatDomainActionView(view)}`,
        exitCode: view.action.status === 'completed' ? 0 : 1,
      }
    }

    case 'status': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output: 'Error: Action ID required. Usage: navin domain status <actionId>',
          exitCode: 1,
        }
      }
      const view = await client.getDomainAction(actionId)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return { output: formatDomainActionView(view), exitCode: 0 }
    }

    case 'rollback': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output: 'Error: Action ID required. Usage: navin domain rollback <actionId>',
          exitCode: 1,
        }
      }
      const view = await client.rollbackDomain(actionId)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Domain action ${view.action.id} is ${view.action.status}\n\n${formatDomainActionView(view)}`,
        exitCode: view.action.status === 'rolled_back' ? 0 : 1,
      }
    }

    default:
      return {
        output: `Unknown domain command: "${action}". Available commands: plan, create, status, rollback.`,
        exitCode: 1,
      }
  }
}

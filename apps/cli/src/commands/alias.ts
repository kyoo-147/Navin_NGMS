import type { NavinCliClient } from '../client.js'
import { formatAliasActionView } from '../format.js'

export interface AliasCommandFlags {
  address?: string
  target?: string
  idempotencyKey?: string
  yes?: boolean
  json?: boolean
}

export async function handleAliasCommand(
  client: NavinCliClient,
  action: string,
  args: string[],
  flags: AliasCommandFlags,
): Promise<{ output: string; exitCode: number }> {
  switch (action) {
    case 'plan': {
      const address = flags.address ?? args[0]
      const target = flags.target ?? args[1]
      if (!address || !target) {
        return {
          output:
            'Error: --address and --target are required. Usage: navin alias plan --address <a> --target <t>',
          exitCode: 1,
        }
      }
      const view = await client.planAlias({
        address,
        target,
        ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
      })
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Planned alias action ${view.action.id}\n\n${formatAliasActionView(view)}`,
        exitCode: 0,
      }
    }

    case 'create': {
      const address = flags.address ?? args[0]
      const target = flags.target ?? args[1]
      if (!address || !target) {
        return {
          output:
            'Error: --address and --target are required. Usage: navin alias create --address <a> --target <t> --yes',
          exitCode: 1,
        }
      }
      // Non-interactive fail-closed: a Tier 1 mutation is never applied without
      // an explicit confirmation flag. The daemon enforces the same rule.
      if (!flags.yes) {
        return {
          output:
            'Error: Tier 1 alias provisioning requires explicit confirmation.\nRe-run with --yes (non-interactive callers fail closed).',
          exitCode: 1,
        }
      }
      const view = await client.createAlias(
        {
          address,
          target,
          confirm: true,
          ...(flags.idempotencyKey === undefined ? {} : { idempotencyKey: flags.idempotencyKey }),
        },
        flags.idempotencyKey,
      )
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Alias action ${view.action.id} is ${view.action.status}\n\n${formatAliasActionView(view)}`,
        exitCode: view.action.status === 'completed' ? 0 : 1,
      }
    }

    case 'status': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output: 'Error: Action ID required. Usage: navin alias status <actionId>',
          exitCode: 1,
        }
      }
      const view = await client.getAliasAction(actionId)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return { output: formatAliasActionView(view), exitCode: 0 }
    }

    case 'rollback': {
      const actionId = args[0]
      if (!actionId) {
        return {
          output: 'Error: Action ID required. Usage: navin alias rollback <actionId>',
          exitCode: 1,
        }
      }
      const view = await client.rollbackAlias(actionId)
      if (flags.json) return { output: JSON.stringify(view, null, 2), exitCode: 0 }
      return {
        output: `Alias action ${view.action.id} is ${view.action.status}\n\n${formatAliasActionView(view)}`,
        exitCode: view.action.status === 'rolled_back' ? 0 : 1,
      }
    }

    default:
      return {
        output: `Unknown alias command: "${action}". Available commands: plan, create, status, rollback.`,
        exitCode: 1,
      }
  }
}

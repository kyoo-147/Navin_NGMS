import type { NavinCliClient } from '../client.js'
import { formatBlocksTable, formatDiffBlock, formatSessionSummary, statusBadge } from '../format.js'

export interface SetupCommandFlags {
  title?: string
  target?: string
  destructive?: boolean
  confirm?: string
  yes?: boolean
  json?: boolean
  cursor?: number
}

export async function handleSetupCommand(
  client: NavinCliClient,
  action: string,
  args: string[],
  flags: SetupCommandFlags,
): Promise<{ output: string; exitCode: number }> {
  switch (action) {
    case 'start': {
      const title = flags.title || args[0] || 'Default Local Setup'
      const session = await client.createSetupSession({
        title,
        targetHost: { kind: flags.target === 'ssh' ? 'ssh_vps' : 'local' },
        destructive: flags.destructive,
      })
      if (flags.json) {
        return { output: JSON.stringify(session, null, 2), exitCode: 0 }
      }
      return {
        output: `Created setup session ${session.id}\n\n${formatSessionSummary(session)}`,
        exitCode: 0,
      }
    }

    case 'show': {
      const sessionId = args[0]
      if (!sessionId) {
        const list = await client.listSetupSessions()
        if (flags.json) return { output: JSON.stringify(list, null, 2), exitCode: 0 }
        if (list.length === 0) return { output: 'No setup sessions found.', exitCode: 0 }
        const summary = list
          .map((s) => `${s.id}  ${statusBadge(s.status).padEnd(12)}  ${s.title}`)
          .join('\n')
        return { output: summary, exitCode: 0 }
      }
      const session = await client.getSetupSession(sessionId)
      if (flags.json) return { output: JSON.stringify(session, null, 2), exitCode: 0 }
      return { output: formatSessionSummary(session), exitCode: 0 }
    }

    case 'blocks': {
      const sessionId = args[0]
      if (!sessionId) {
        return {
          output: 'Error: Session ID required. Usage: navin setup blocks <sessionId>',
          exitCode: 1,
        }
      }
      const session = await client.getSetupSession(sessionId)
      if (flags.json) return { output: JSON.stringify(session.blocks, null, 2), exitCode: 0 }
      return { output: formatBlocksTable(session.blocks), exitCode: 0 }
    }

    case 'resume': {
      const sessionId = args[0]
      if (!sessionId) {
        return {
          output: 'Error: Session ID required. Usage: navin setup resume <sessionId>',
          exitCode: 1,
        }
      }
      const session = await client.resumeSetupSession(sessionId)
      if (flags.json) return { output: JSON.stringify(session, null, 2), exitCode: 0 }
      return {
        output: `Resumed setup session ${session.id}\n\n${formatSessionSummary(session)}`,
        exitCode: 0,
      }
    }

    case 'discover':
    case 'plan':
    case 'diff':
    case 'approve':
    case 'apply':
    case 'verify': {
      const sessionId = args[0]
      if (!sessionId) {
        return {
          output: `Error: Session ID required. Usage: navin setup ${action} <sessionId>`,
          exitCode: 1,
        }
      }

      // Tier 3 Fail-closed validation for CLI
      if (action === 'approve' || action === 'apply') {
        const session = await client.getSetupSession(sessionId)
        const targetKind = action === 'approve' ? 'approval' : 'action'
        const block = session.blocks.find((b) => b.kind === targetKind)

        if (block?.risk === 'destructive') {
          const expectedPhrase = `confirm ${session.id}`
          if (flags.yes && !flags.confirm) {
            return {
              output: `Error: Tier 3 destructive operation cannot be bypassed with --yes.\nExplicit --confirm "${expectedPhrase}" is mandatory.`,
              exitCode: 1,
            }
          }
          if (!flags.confirm) {
            return {
              output: `Error: Tier 3 destructive operation requires confirmation.\nPlease pass --confirm "${expectedPhrase}".`,
              exitCode: 1,
            }
          }
          if (flags.confirm.trim() !== expectedPhrase) {
            return {
              output: `Error: Tier 3 confirmation mismatch. Expected "${expectedPhrase}", got "${flags.confirm}".`,
              exitCode: 1,
            }
          }
        }
      }

      const updated = await client.runSetupCommand(sessionId, action, {
        confirmation: flags.confirm,
        force: flags.yes,
      })

      if (flags.json) {
        return { output: JSON.stringify(updated, null, 2), exitCode: 0 }
      }

      if (action === 'diff') {
        const diffBlock = updated.blocks.find((b) => b.kind === 'diff')
        return {
          output: `Diff for setup ${sessionId}:\n\n${diffBlock ? formatDiffBlock(diffBlock) : 'No diff'}`,
          exitCode: 0,
        }
      }

      return {
        output: `Successfully ran ${action} on setup ${sessionId}.\nStage: ${updated.currentStage}, Status: ${statusBadge(updated.status)}`,
        exitCode: 0,
      }
    }

    case 'evidence': {
      const sessionId = args[0]
      const evidenceId = args[1]
      if (!sessionId) {
        return {
          output:
            'Error: Session ID required. Usage: navin setup evidence <sessionId> [evidenceId]',
          exitCode: 1,
        }
      }
      const session = await client.getSetupSession(sessionId)
      const allEvidence: unknown[] = []
      for (const block of session.blocks) {
        const metadata = (block as { metadata?: { evidence?: unknown[] } }).metadata
        if (metadata?.evidence) {
          allEvidence.push(...metadata.evidence)
        }
      }
      if (evidenceId) {
        const item = (allEvidence as { id?: string }[]).find((e) => e.id === evidenceId)
        if (!item)
          return {
            output: `Evidence ${evidenceId} not found in session ${sessionId}.`,
            exitCode: 1,
          }
        return { output: JSON.stringify(item, null, 2), exitCode: 0 }
      }
      if (flags.json) return { output: JSON.stringify(allEvidence, null, 2), exitCode: 0 }
      if (allEvidence.length === 0)
        return { output: `No evidence collected yet for session ${sessionId}.`, exitCode: 0 }
      return { output: JSON.stringify(allEvidence, null, 2), exitCode: 0 }
    }

    case 'events': {
      const sessionId = args[0]
      if (!sessionId) {
        return {
          output: 'Error: Session ID required. Usage: navin setup events <sessionId>',
          exitCode: 1,
        }
      }
      const cursor = flags.cursor || 0
      const eventsList: string[] = []
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)

      try {
        await client.streamEvents(
          sessionId,
          cursor,
          (event, seq) => {
            eventsList.push(`[seq ${seq}] ${event.kind} at ${event.timestamp}`)
          },
          controller.signal,
        )
      } catch {
        // timeout or abort is expected for test / short listen
      } finally {
        clearTimeout(timeout)
      }

      return {
        output: eventsList.length > 0 ? eventsList.join('\n') : 'Listening for setup events...',
        exitCode: 0,
      }
    }

    default:
      return {
        output: `Unknown setup command: "${action}". Available commands: start, show, resume, blocks, plan, diff, approve, apply, verify, evidence, events.`,
        exitCode: 1,
      }
  }
}

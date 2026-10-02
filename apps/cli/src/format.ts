import type { SetupBlock, SetupSession } from '@navin/contracts'
import type { AliasActionView } from './client.js'

export function statusBadge(status: string): string {
  switch (status) {
    case 'passed':
    case 'completed':
      return '✓ ' + status
    case 'running':
    case 'applying':
    case 'verifying':
    case 'rolling_back':
    case 'awaiting_approval':
      return '⧖ ' + status
    case 'staged':
    case 'planned':
    case 'ready':
    case 'queued':
    case 'approved':
      return '• ' + status
    case 'warning':
      return '▲ warning'
    case 'failed':
    case 'rollback_failed':
    case 'rejected':
      return '✗ ' + status
    case 'blocked':
      return '⊘ blocked'
    case 'retrying':
      return '↻ retrying'
    case 'rolled_back':
      return '↩ rolled_back'
    default:
      return `○ ${status}`
  }
}

export function formatSessionSummary(session: SetupSession): string {
  const lines = [
    `Setup Session: ${session.id}`,
    `Title:         ${session.title}`,
    `Status:        ${statusBadge(session.status)}`,
    `Current Stage: ${session.currentStage}`,
    `Intelligence:  ${session.intelligenceMode}`,
    `Target:        ${session.targetHost ? JSON.stringify(session.targetHost) : 'local'}`,
    `Blocks:        ${session.blocks.filter((b) => b.status === 'passed').length}/${session.blocks.length} passed`,
    `Created:       ${session.createdAt}`,
    `Updated:       ${session.updatedAt}`,
  ]
  return lines.join('\n')
}

export function formatBlocksTable(blocks: SetupBlock[]): string {
  const header = ['Stage', 'Kind', 'Status', 'Risk', 'Block Title']
  const rows = blocks.map((b) => [
    b.stage.padEnd(14),
    b.kind.padEnd(12),
    statusBadge(b.status).padEnd(12),
    (b.risk || '-').padEnd(12),
    b.title,
  ])

  const tableHeader = `${header[0]?.padEnd(14)} ${header[1]?.padEnd(12)} ${header[2]?.padEnd(12)} ${header[3]?.padEnd(12)} ${header[4]}`
  const separator = '-'.repeat(tableHeader.length + 10)

  return [tableHeader, separator, ...rows.map((r) => r.join(' '))].join('\n')
}

export function formatDiffBlock(block: SetupBlock): string {
  const output = (block.value as { output?: Record<string, unknown> } | undefined)?.output
  if (!output) {
    return 'No diff recorded yet.'
  }
  return JSON.stringify(output, null, 2)
}

export function formatAliasActionView(view: AliasActionView): string {
  const alias = `${parameterValue(view, 'address')} -> ${parameterValue(view, 'target')}`
  return formatOrganizationActionView(view, `Alias:        ${alias}`)
}

export function formatDomainActionView(view: AliasActionView): string {
  return formatOrganizationActionView(view, `Domain:       ${parameterValue(view, 'name')}`)
}

export function formatMailboxActionView(view: AliasActionView): string {
  return formatOrganizationActionView(view, `Mailbox:      ${parameterValue(view, 'email')}`)
}

function parameterValue(view: AliasActionView, key: string): string {
  const value = view.action.parameters[key]
  return value === undefined ? '-' : String(value)
}

function formatOrganizationActionView(view: AliasActionView, resourceLine: string): string {
  const { action } = view
  const lines = [
    `Action:       ${action.id}`,
    `Name:         ${action.name}`,
    `Status:       ${statusBadge(action.status)}`,
    `Stage:        ${action.stage}`,
    `Risk:         Tier ${action.riskTier}`,
    `Rollbackable: ${action.canRollback ? 'yes' : 'no'}`,
    resourceLine,
  ]
  if (action.diff) {
    lines.push(`Diff:         ${action.diff.summary}`)
    for (const change of action.diff.changes) {
      const value = change.newValue === undefined ? '' : ` = ${JSON.stringify(change.newValue)}`
      lines.push(`  ${change.op} ${change.path}${value}`)
    }
  }
  if (action.verification) {
    lines.push(
      `Verification: ${action.verification.passed ? 'passed' : 'failed'} (${action.verification.command})`,
    )
  }
  if (action.error) {
    lines.push(`Error:        [${action.error.code}] ${action.error.message}`)
  }
  if (view.attempts.length > 0) {
    lines.push(`Attempts:     ${view.attempts.map((a) => `${a.attempt}:${a.status}`).join(', ')}`)
  }
  if (view.job) {
    lines.push(`Job:          ${view.job.id} (${view.job.status})`)
  }
  if (view.evidence.length > 0) {
    lines.push(`Evidence:     ${view.evidence.map((e) => `${e.id}:${e.status}`).join(', ')}`)
  }
  return lines.join('\n')
}

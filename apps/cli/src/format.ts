import type { SetupBlock, SetupSession } from '@navin/contracts'

export function statusBadge(status: string): string {
  switch (status) {
    case 'passed':
      return '✓ passed'
    case 'running':
      return '⧖ running'
    case 'ready':
      return '• ready'
    case 'warning':
      return '▲ warning'
    case 'failed':
      return '✗ failed'
    case 'blocked':
      return '⊘ blocked'
    case 'retrying':
      return '↻ retrying'
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

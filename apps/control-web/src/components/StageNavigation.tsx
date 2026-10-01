import React from 'react'
import { StatusBadge, type StatusTone } from '@navin/ui-primitives'

export const SETUP_STAGES = [
  'WELCOME',
  'DISCOVER',
  'PLAN',
  'APPROVAL',
  'APPLY',
  'VERIFY_INFRA',
  'READY',
] as const

export interface StageNavigationProps {
  currentStage: string
  completedStages: string[]
  onSelectStage?: (stage: string) => void
}

export function StageNavigation({
  currentStage,
  completedStages,
  onSelectStage,
}: StageNavigationProps): React.JSX.Element {
  return (
    <nav aria-label="Setup journey stages" className="setup-stage-nav" style={{ display: 'flex', gap: '8px', padding: '12px 0', borderBottom: '1px solid #ccc', overflowX: 'auto' }}>
      {SETUP_STAGES.map((stage) => {
        const isCurrent = stage === currentStage
        const isPassed = completedStages.includes(stage)
        const tone: StatusTone = isPassed ? 'success' : isCurrent ? 'info' : 'neutral'

        return (
          <button
            key={stage}
            type="button"
            onClick={() => onSelectStage?.(stage)}
            style={{
              background: 'none',
              border: isCurrent ? '2px solid #005fb8' : '1px solid transparent',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: onSelectStage ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <StatusBadge tone={tone}>
              {stage}
            </StatusBadge>
          </button>
        )
      })}
    </nav>
  )
}

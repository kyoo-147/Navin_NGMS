import type { HTMLAttributes } from 'react'
import { cx } from '../utils/cx.js'

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger'

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  value?: number
  max?: number
  /** Renders an animated bar with no `aria-valuenow`. */
  indeterminate?: boolean
  label?: string
  showValue?: boolean
  tone?: ProgressTone
}

function normalizeMax(max: number): number {
  return Number.isFinite(max) && max > 0 ? max : 100
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), max)
}

export function Progress({
  value = 0,
  max = 100,
  indeterminate = false,
  label,
  showValue = false,
  tone = 'accent',
  className,
  children,
  ...rest
}: ProgressProps) {
  const { 'aria-label': ariaLabel, ...divProps } = rest
  const safeMax = normalizeMax(max)
  const current = clamp(value, safeMax)
  const percent = Math.round((current / safeMax) * 100)

  return (
    <div {...divProps} className={cx('navin-progress', className)}>
      <div
        className={cx(
          'navin-progress__track',
          indeterminate && 'navin-progress__track--indeterminate',
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={indeterminate ? undefined : current}
        aria-valuetext={showValue && !indeterminate ? `${percent}%` : undefined}
        aria-label={label ?? ariaLabel}
      >
        <div
          className={cx('navin-progress__bar', `navin-progress__bar--${tone}`)}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      {showValue ? (
        <span className="navin-progress__value" aria-hidden="true">
          {children ?? `${percent}%`}
        </span>
      ) : null}
    </div>
  )
}

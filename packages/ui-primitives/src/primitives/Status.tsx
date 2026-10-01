import type { HTMLAttributes } from 'react'
import { cx } from '../utils/cx.js'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  tone?: StatusTone
  /** Visible label rendered next to the dot. Provide `aria-label` when omitted. */
  label?: string
  pulse?: boolean
}

export function StatusDot({
  tone = 'neutral',
  label,
  pulse = false,
  className,
  ...rest
}: StatusDotProps) {
  return (
    <span {...rest} className={cx('navin-status', className)}>
      <span
        className={cx(
          'navin-status__dot',
          `navin-status__dot--${tone}`,
          pulse && 'navin-status__dot--pulse',
        )}
        aria-hidden="true"
      />
      {label ? <span className="navin-status__label">{label}</span> : null}
    </span>
  )
}

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
}

export function StatusBadge({ tone = 'neutral', className, children, ...rest }: StatusBadgeProps) {
  return (
    <span {...rest} className={cx('navin-badge', `navin-badge--${tone}`, className)}>
      {children}
    </span>
  )
}

import { cx } from './cx.js'

export type SpinnerSize = 'sm' | 'md' | 'lg'

export interface SpinnerProps {
  size?: SpinnerSize
  className?: string
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span className={cx('navin-spinner', `navin-spinner--${size}`, className)} aria-hidden="true" />
  )
}

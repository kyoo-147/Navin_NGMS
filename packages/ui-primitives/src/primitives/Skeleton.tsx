import type { CSSProperties } from 'react'
import { cx } from '../utils/cx.js'

export type SkeletonVariant = 'text' | 'rect' | 'circle'

export interface SkeletonProps {
  variant?: SkeletonVariant
  width?: number | string
  height?: number | string
  /** Number of stacked text lines (text variant only). */
  lines?: number
  radius?: number | string
  className?: string
  style?: CSSProperties
  /** When set, the skeleton is exposed as a labelled `role="status"` instead of decorative. */
  'aria-label'?: string
}

function dimension(value: number | string | undefined): string | undefined {
  if (typeof value === 'number') return `${value}px`
  return value
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  radius,
  className,
  style,
  'aria-label': ariaLabel,
}: SkeletonProps) {
  const decorative = !ariaLabel
  const baseStyle: CSSProperties = {
    width: dimension(width),
    height: dimension(height),
    borderRadius:
      variant === 'circle' ? '50%' : radius === undefined ? undefined : dimension(radius),
    ...style,
  }

  if (variant === 'text' && lines > 1) {
    return (
      <span
        className={cx('navin-skeleton-group', className)}
        aria-hidden={decorative ? true : undefined}
        aria-label={ariaLabel}
        role={ariaLabel ? 'status' : undefined}
      >
        {Array.from({ length: lines }).map((_, index) => (
          <span
            key={index}
            className="navin-skeleton navin-skeleton--text"
            style={{ ...baseStyle, width: index === lines - 1 ? '60%' : baseStyle.width }}
          />
        ))}
      </span>
    )
  }

  return (
    <span
      className={cx('navin-skeleton', `navin-skeleton--${variant}`, className)}
      style={baseStyle}
      aria-hidden={decorative ? true : undefined}
      aria-label={ariaLabel}
      role={ariaLabel ? 'status' : undefined}
    />
  )
}

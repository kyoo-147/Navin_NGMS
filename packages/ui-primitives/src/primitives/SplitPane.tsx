import { useCallback, useId, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { cx } from '../utils/cx.js'

export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitPaneProps {
  primary: ReactNode
  secondary: ReactNode
  /** `horizontal` places panes side by side; `vertical` stacks them. */
  direction?: SplitDirection
  /** Initial size of the primary pane as a percentage (uncontrolled). */
  defaultSize?: number
  /** Controlled size of the primary pane as a percentage. */
  size?: number
  onSizeChange?: (size: number) => void
  minSize?: number
  maxSize?: number
  primaryLabel?: string
  secondaryLabel?: string
  className?: string
  /** Accessible name for the resize separator. */
  ariaLabel?: string
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function SplitPane({
  primary,
  secondary,
  direction = 'horizontal',
  defaultSize = 50,
  size,
  onSizeChange,
  minSize = 20,
  maxSize = 80,
  primaryLabel,
  secondaryLabel,
  className,
  ariaLabel,
}: SplitPaneProps) {
  const [internalSize, setInternalSize] = useState(defaultSize)
  const isControlled = size !== undefined
  const current = clamp(isControlled ? size : internalSize, minSize, maxSize)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const reactId = useId()
  const primaryPaneId = `${reactId}-primary`
  const secondaryPaneId = `${reactId}-secondary`

  const apply = useCallback(
    (next: number) => {
      const nextClamped = clamp(next, minSize, maxSize)
      if (!isControlled) {
        setInternalSize(nextClamped)
      }
      onSizeChange?.(nextClamped)
    },
    [isControlled, minSize, maxSize, onSizeChange],
  )

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    draggingRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio =
      direction === 'horizontal'
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((event.clientY - rect.top) / rect.height) * 100
    apply(ratio)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2
    const decreaseKey = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const increaseKey = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    let next: number
    switch (event.key) {
      case decreaseKey:
        next = current - step
        break
      case increaseKey:
        next = current + step
        break
      case 'Home':
        next = minSize
        break
      case 'End':
        next = maxSize
        break
      default:
        return
    }
    event.preventDefault()
    apply(next)
  }

  return (
    <div
      ref={containerRef}
      className={cx('navin-split', `navin-split--${direction}`, className)}
      data-testid="navin-split"
    >
      <div
        id={primaryPaneId}
        className="navin-split__pane"
        style={{ flexBasis: `${current}%` }}
        aria-label={primaryLabel}
      >
        {primary}
      </div>
      <div
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={Math.round(current)}
        aria-label={ariaLabel ?? 'Resize panels'}
        aria-controls={primaryPaneId}
        tabIndex={0}
        className="navin-split__divider"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => apply(defaultSize)}
      >
        <span className="navin-split__grip" aria-hidden="true" />
      </div>
      <div
        id={secondaryPaneId}
        className="navin-split__pane"
        style={{ flexBasis: `${100 - current}%` }}
        aria-label={secondaryLabel}
      >
        {secondary}
      </div>
    </div>
  )
}

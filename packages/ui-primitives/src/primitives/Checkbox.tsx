import { forwardRef, useEffect, useId, useRef } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '../utils/cx.js'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  /** Renders the mixed state and exposes `aria-checked="mixed"`. */
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, indeterminate = false, id, className, disabled, ...rest },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const innerRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('navin-checkbox-field', disabled && 'navin-field--disabled', className)}>
      <label className="navin-checkbox" htmlFor={inputId}>
        <input
          {...rest}
          ref={(node) => {
            innerRef.current = node
            if (typeof ref === 'function') {
              ref(node)
            } else if (ref) {
              ref.current = node
            }
          }}
          id={inputId}
          type="checkbox"
          className="navin-checkbox__input"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-checked={indeterminate ? 'mixed' : undefined}
        />
        <span className="navin-checkbox__label">{label}</span>
      </label>
      {description ? (
        <p className="navin-field__hint" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="navin-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
})

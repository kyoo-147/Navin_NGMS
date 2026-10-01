import type { ReactNode } from 'react'
import { cx } from './cx.js'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

export interface FieldShellProps {
  id: string
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  className?: string
  children: (controlProps: FieldControlProps) => ReactNode
}

export function FieldShell({
  id,
  label,
  description,
  error,
  required = false,
  disabled = false,
  className,
  children,
}: FieldShellProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('navin-field', disabled && 'navin-field--disabled', className)}>
      {label ? (
        <label className="navin-field__label" htmlFor={id}>
          {label}
          {required ? (
            <span className="navin-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
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
}

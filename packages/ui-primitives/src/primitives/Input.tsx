import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '../utils/cx.js'
import { FieldShell } from '../utils/FieldShell.js'

export type FieldSize = 'sm' | 'md' | 'lg'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
  fieldSize?: FieldSize
  /** Class applied to the field wrapper instead of the input control. */
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    error,
    fieldSize = 'md',
    id,
    className,
    wrapperClassName,
    required,
    disabled,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <FieldShell
      id={inputId}
      label={label}
      description={description}
      error={error}
      required={required}
      disabled={disabled}
      className={wrapperClassName}
    >
      {(controlProps) => (
        <input
          {...rest}
          {...controlProps}
          ref={ref}
          className={cx(
            'navin-input',
            `navin-input--${fieldSize}`,
            Boolean(error) && 'navin-input--invalid',
            className,
          )}
          disabled={disabled}
          required={required}
        />
      )}
    </FieldShell>
  )
})

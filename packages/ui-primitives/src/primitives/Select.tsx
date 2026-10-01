import { forwardRef, useId } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { cx } from '../utils/cx.js'
import { FieldShell } from '../utils/FieldShell.js'
import type { FieldSize } from './Input.js'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size' | 'children'
> {
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
  fieldSize?: FieldSize
  placeholder?: string
  options?: SelectOption[]
  children?: ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    description,
    error,
    fieldSize = 'md',
    placeholder,
    options,
    children,
    id,
    className,
    required,
    disabled,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <FieldShell
      id={selectId}
      label={label}
      description={description}
      error={error}
      required={required}
      disabled={disabled}
      className={className}
    >
      {(controlProps) => (
        <select
          {...rest}
          {...controlProps}
          ref={ref}
          className={cx(
            'navin-select',
            `navin-select--${fieldSize}`,
            Boolean(error) && 'navin-input--invalid',
          )}
          disabled={disabled}
          required={required}
        >
          {placeholder ? (
            <option value="" disabled={required} hidden={required}>
              {placeholder}
            </option>
          ) : null}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
      )}
    </FieldShell>
  )
})

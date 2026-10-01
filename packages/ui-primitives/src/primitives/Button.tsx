import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../utils/cx.js'
import { Spinner } from '../utils/Spinner.js'
import { VisuallyHidden } from '../utils/VisuallyHidden.js'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, sets `aria-busy` and blocks activation. */
  loading?: boolean
  /** Announced to assistive technology while `loading` is true. */
  loadingLabel?: string
  /** Stretch to the full width of the container. */
  block?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel,
    block = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'navin-btn',
        `navin-btn--${variant}`,
        `navin-btn--${size}`,
        block && 'navin-btn--block',
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : leadingIcon ? (
        <span className="navin-btn__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span className="navin-btn__label">{children}</span>
      {trailingIcon && !loading ? (
        <span className="navin-btn__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
      {loading && loadingLabel ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
    </button>
  )
})

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'leadingIcon' | 'trailingIcon' | 'block'
> {
  /** Icon-only controls must always expose an accessible name. */
  'aria-label': string
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    className,
    children,
    variant = 'ghost',
    size = 'md',
    loading = false,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'navin-btn',
        'navin-btn--icon',
        `navin-btn--${variant}`,
        `navin-btn--${size}`,
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <span className="navin-btn__icon" aria-hidden="true">
          {children}
        </span>
      )}
    </button>
  )
})

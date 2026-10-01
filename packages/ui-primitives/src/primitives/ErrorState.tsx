import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../utils/cx.js'
import { ErrorIcon } from '../utils/icons.js'

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** What failed. */
  title?: ReactNode
  /** What the user can do next. */
  description?: ReactNode
  /** Why it failed, when known. */
  cause?: ReactNode
  action?: ReactNode
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  cause,
  action,
  className,
  role = 'alert',
  ...rest
}: ErrorStateProps) {
  return (
    <div {...rest} role={role} className={cx('navin-error', className)}>
      <span className="navin-error__icon" aria-hidden="true">
        <ErrorIcon />
      </span>
      <h3 className="navin-error__title">{title}</h3>
      {description ? <p className="navin-error__description">{description}</p> : null}
      {cause ? <p className="navin-error__cause">{cause}</p> : null}
      {action ? <div className="navin-error__action">{action}</div> : null}
    </div>
  )
}

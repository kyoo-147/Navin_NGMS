import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../utils/cx.js'
import { EmptyIcon } from '../utils/icons.js'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} className={cx('navin-empty', className)}>
      <span className="navin-empty__icon" aria-hidden="true">
        {icon ?? <EmptyIcon />}
      </span>
      <h3 className="navin-empty__title">{title}</h3>
      {description ? <p className="navin-empty__description">{description}</p> : null}
      {action ? <div className="navin-empty__action">{action}</div> : null}
    </div>
  )
}

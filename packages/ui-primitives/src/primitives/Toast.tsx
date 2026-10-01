import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../utils/cx.js'
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from '../utils/icons.js'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  tone?: ToastTone
  /** Auto-dismiss after this many ms. `0` keeps the toast until dismissed. */
  duration?: number
  action?: ReactNode
}

export interface ToastRecord extends ToastOptions {
  id: string
}

function toneIcon(tone: ToastTone): ReactNode {
  switch (tone) {
    case 'success':
      return <SuccessIcon />
    case 'warning':
      return <WarningIcon />
    case 'danger':
      return <ErrorIcon />
    default:
      return <InfoIcon />
  }
}

export interface ToastProps {
  tone?: ToastTone
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

export function Toast({
  tone = 'info',
  title,
  description,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
}: ToastProps) {
  const role = tone === 'danger' ? 'alert' : 'status'

  return (
    <div className={cx('navin-toast', `navin-toast--${tone}`, className)} role={role}>
      <span className="navin-toast__icon" aria-hidden="true">
        {toneIcon(tone)}
      </span>
      <div className="navin-toast__content">
        <p className="navin-toast__title">{title}</p>
        {description ? <p className="navin-toast__description">{description}</p> : null}
        {action ? <div className="navin-toast__action">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="navin-toast__close"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <CloseIcon />
        </button>
      ) : null}
    </div>
  )
}

interface ToastItemProps {
  record: ToastRecord
  onDismiss: () => void
}

function ToastItem({ record, onDismiss }: ToastItemProps) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const duration = record.duration ?? 5000

  useEffect(() => {
    if (duration <= 0) return
    const timer = window.setTimeout(() => dismissRef.current(), duration)
    return () => window.clearTimeout(timer)
  }, [duration])

  return (
    <Toast
      tone={record.tone}
      title={record.title}
      description={record.description}
      action={record.action}
      onDismiss={() => dismissRef.current()}
    />
  )
}

export interface ToastViewportProps {
  toasts: ToastRecord[]
  onDismiss: (id: string) => void
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div className="navin-toast-region" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} record={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  )
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
  toasts: ToastRecord[]
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export interface ToastProviderProps {
  children?: ReactNode
  /** Maximum number of simultaneous toasts; the oldest are dropped. */
  limit?: number
}

export function ToastProvider({ children, limit = 4 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      counter.current += 1
      const id = `navin-toast-${counter.current}`
      setToasts((current) => {
        const next = [...current, { ...options, id }]
        return next.length > limit ? next.slice(next.length - limit) : next
      })
      return id
    },
    [limit],
  )

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, toasts }),
    [toast, dismiss, toasts],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

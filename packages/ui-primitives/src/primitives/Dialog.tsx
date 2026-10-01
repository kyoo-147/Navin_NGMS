import { useCallback, useEffect, useId, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../utils/cx.js'
import { Button } from './Button.js'
import { CloseIcon } from '../utils/icons.js'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface DialogProps {
  open: boolean
  /** Called when the dialog requests to close (Esc, overlay click, close button). */
  onOpenChange?: (open: boolean) => void
  role?: 'dialog' | 'alertdialog'
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  closeOnEsc?: boolean
  closeOnOverlayClick?: boolean
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  role = 'dialog',
  title,
  description,
  children,
  footer,
  initialFocusRef,
  closeOnEsc = true,
  closeOnOverlayClick = true,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const reactId = useId()
  const titleId = `${reactId}-title`
  const descriptionId = description ? `${reactId}-description` : undefined

  const close = useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement
    const target = initialFocusRef?.current ?? dialogRef.current
    target?.focus()
    return () => {
      const previous = previouslyFocused.current
      if (previous instanceof HTMLElement) {
        previous.focus()
      }
    }
  }, [open, initialFocusRef])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (!closeOnEsc) return
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const node = dialogRef.current
    if (!node) return
    const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) {
      event.preventDefault()
      node.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="navin-dialog__overlay"
      data-testid="navin-dialog-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cx('navin-dialog', className)}
        onKeyDown={handleKeyDown}
      >
        <div className="navin-dialog__header">
          <h2 className="navin-dialog__title" id={titleId}>
            {title}
          </h2>
          {onOpenChange ? (
            <button
              type="button"
              className="navin-dialog__close"
              aria-label="Close"
              onClick={close}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
        {description ? (
          <p className="navin-dialog__description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children ? <div className="navin-dialog__body">{children}</div> : null}
        {footer ? <div className="navin-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export interface AlertDialogProps extends Omit<
  DialogProps,
  'role' | 'footer' | 'closeOnOverlayClick'
> {
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  onCancel?: () => void
  tone?: 'default' | 'danger'
  confirmLoading?: boolean
}

export function AlertDialog({
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  tone = 'default',
  confirmLoading = false,
  children,
  ...dialogProps
}: AlertDialogProps) {
  const handleCancel = () => {
    onCancel?.()
    dialogProps.onOpenChange?.(false)
  }

  return (
    <Dialog
      {...dialogProps}
      role="alertdialog"
      closeOnOverlayClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={handleCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={confirmLoading}
            onClick={() => onConfirm?.()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

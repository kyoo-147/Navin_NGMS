import React, { useEffect, useState } from 'react'

export interface UndoToastProps {
  message: string
  seconds: number
  onUndo: () => void
  onDismiss: () => void
}

export const UndoToast: React.FC<UndoToastProps> = ({ message, seconds, onUndo, onDismiss }) => {
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    if (remaining <= 0) {
      onDismiss()
      return
    }
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onDismiss()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [remaining, onDismiss])

  return (
    <div className="mail-undo-toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onUndo} aria-label={`Undo action (${remaining}s remaining)`}>
        Undo ({remaining}s)
      </button>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          fontSize: '1rem',
          cursor: 'pointer',
          padding: '0 4px',
        }}
        aria-label="Dismiss undo notification"
      >
        ✕
      </button>
    </div>
  )
}

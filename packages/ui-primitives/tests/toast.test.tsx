import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Toast, ToastProvider, useToast } from '../src/index.js'

describe('Toast', () => {
  it('uses role="status" for non-critical tones', () => {
    render(<Toast title="Saved" tone="success" />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('uses role="alert" for danger', () => {
    render(<Toast title="Failed" tone="danger" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
  })

  it('dismisses through the close button', async () => {
    const onDismiss = vi.fn()
    render(<Toast title="Saved" onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

function NotifyButton({ duration }: { duration?: number }) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast({ title: 'Hello', tone: 'info', duration })}>
      Notify
    </button>
  )
}

describe('ToastProvider', () => {
  it('queues toasts and keeps at most `limit` visible', async () => {
    render(
      <ToastProvider limit={1}>
        <NotifyButton />
      </ToastProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'Notify' })
    await userEvent.click(trigger)
    await userEvent.click(trigger)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('auto-dismisses a toast after its duration', () => {
    vi.useFakeTimers()
    try {
      render(
        <ToastProvider>
          <NotifyButton duration={50} />
        </ToastProvider>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
      expect(screen.getByRole('status')).toHaveTextContent('Hello')
      act(() => {
        vi.advanceTimersByTime(60)
      })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws a clear error when useToast is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<NotifyButton />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

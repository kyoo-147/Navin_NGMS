import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog, Button, Dialog } from '../src/index.js'

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(
      <Dialog open={false} title="Hidden">
        <p>body</p>
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders an accessible modal and labels it', () => {
    render(
      <Dialog open title="Delete server" description="This cannot be undone">
        <p>body</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Delete server')
    expect(dialog).toHaveAccessibleDescription('This cannot be undone')
  })

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog open title="Close me" onOpenChange={onOpenChange}>
        <button type="button">Inside</button>
      </Dialog>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('traps focus within the dialog', async () => {
    render(
      <Dialog open title="Trap" onOpenChange={() => {}} footer={<Button>Confirm</Button>}>
        <button type="button">First</button>
      </Dialog>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    confirm.focus()
    await userEvent.tab()
    expect(close).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(confirm).toHaveFocus()
  })

  it('restores focus to the previously focused element when closed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} title="Restore" onOpenChange={setOpen}>
            <button type="button" onClick={() => setOpen(false)}>
              Dismiss
            </button>
          </Dialog>
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(trigger).toHaveFocus()
  })

  it('closes when the overlay is clicked', async () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog open title="Overlay" onOpenChange={onOpenChange}>
        <p>body</p>
      </Dialog>,
    )
    await userEvent.click(screen.getByTestId('navin-dialog-overlay'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('AlertDialog', () => {
  it('renders an alertdialog with confirm/cancel actions', async () => {
    const onConfirm = vi.fn()
    render(
      <AlertDialog
        open
        title="Delete mailbox?"
        description="This cannot be undone"
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        onConfirm={onConfirm}
        onOpenChange={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Delete mailbox?')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
  })
})

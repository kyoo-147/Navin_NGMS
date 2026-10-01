import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, IconButton } from '../src/index.js'

describe('Button', () => {
  it('renders an accessible button with a safe default type', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
  })

  it('propagates disabled state and blocks activation', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('exposes aria-busy and blocks activation while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading loadingLabel="Saving" onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: /Save/ })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Saving')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders leading and trailing icons without polluting the accessible name', () => {
    render(
      <Button leadingIcon={<span data-testid="lead" />} trailingIcon={<span data-testid="trail" />}>
        Continue
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByTestId('lead')).toBeInTheDocument()
    expect(screen.getByTestId('trail')).toBeInTheDocument()
  })

  it('truncates long labels instead of overflowing', () => {
    const long = 'A very long button label that must stay inside the control'
    render(<Button>{long}</Button>)
    expect(
      screen.getByRole('button', { name: long }).querySelector('.navin-btn__label'),
    ).toHaveClass('navin-btn__label')
  })
})

describe('IconButton', () => {
  it('exposes the required accessible name', () => {
    render(
      <IconButton aria-label="Close">
        <span />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

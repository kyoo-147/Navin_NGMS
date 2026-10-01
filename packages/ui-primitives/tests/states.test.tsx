import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, ErrorState } from '../src/index.js'

describe('EmptyState', () => {
  it('renders an actionable empty message', () => {
    render(
      <EmptyState
        title="No mail yet"
        description="Messages you receive will appear here."
        action={<button type="button">Compose</button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No mail yet' })).toBeInTheDocument()
    expect(screen.getByText('Messages you receive will appear here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('announces what failed, why and what to do next', () => {
    render(
      <ErrorState
        title="Could not load the mailbox"
        cause="Network timeout"
        description="Retry in a moment."
        action={<button type="button">Retry</button>}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load the mailbox')
    expect(alert).toHaveTextContent('Network timeout')
    expect(alert).toHaveTextContent('Retry in a moment.')
  })

  it('falls back to a safe default title', () => {
    render(<ErrorState />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
  })
})

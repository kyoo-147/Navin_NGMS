import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge, StatusDot } from '../src/index.js'

describe('StatusDot', () => {
  it('hides the decorative dot and shows the visible label', () => {
    const { container } = render(<StatusDot tone="success" label="Healthy" />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(container.querySelector('.navin-status__dot')).toHaveAttribute('aria-hidden', 'true')
  })

  it('supports an explicit aria-label when no visible label is given', () => {
    const { container } = render(<StatusDot tone="danger" aria-label="Unhealthy" />)
    expect(container.querySelector('[aria-label="Unhealthy"]')).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  it('renders the tone class and its content', () => {
    const { container } = render(<StatusBadge tone="warning">Quota low</StatusBadge>)
    expect(screen.getByText('Quota low')).toBeInTheDocument()
    expect(container.querySelector('.navin-badge--warning')).toBeInTheDocument()
  })
})

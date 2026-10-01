import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton } from '../src/index.js'

describe('Skeleton', () => {
  it('is decorative by default', () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelector('.navin-skeleton')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders multiple text lines with the last line shortened', () => {
    const { container } = render(<Skeleton lines={3} />)
    expect(container.querySelectorAll('.navin-skeleton--text')).toHaveLength(3)
  })

  it('becomes an announced status when labelled', () => {
    render(<Skeleton aria-label="Loading content" />)
    expect(screen.getByRole('status', { name: 'Loading content' })).toBeInTheDocument()
  })

  it('supports circle and rect variants', () => {
    const { container } = render(
      <>
        <Skeleton variant="circle" width={32} height={32} />
        <Skeleton variant="rect" height={80} />
      </>,
    )
    expect(container.querySelector('.navin-skeleton--circle')).toBeInTheDocument()
    expect(container.querySelector('.navin-skeleton--rect')).toBeInTheDocument()
  })
})

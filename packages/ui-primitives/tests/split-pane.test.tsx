import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SplitPane } from '../src/index.js'

describe('SplitPane', () => {
  it('renders a labelled separator with value bounds', () => {
    render(
      <SplitPane
        primary={<div>left</div>}
        secondary={<div>right</div>}
        ariaLabel="Resize panels"
      />,
    )
    const separator = screen.getByRole('separator', { name: 'Resize panels' })
    expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator).toHaveAttribute('aria-valuenow', '50')
    expect(separator).toHaveAttribute('aria-valuemin', '20')
    expect(separator).toHaveAttribute('aria-valuemax', '80')
    expect(separator).toHaveAttribute('tabindex', '0')
  })

  it('resizes with the keyboard', async () => {
    render(<SplitPane primary={<div />} secondary={<div />} defaultSize={50} />)
    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(separator).toHaveAttribute('aria-valuenow', '54')
  })

  it('clamps keyboard resizing within bounds', async () => {
    render(
      <SplitPane
        primary={<div />}
        secondary={<div />}
        defaultSize={21}
        minSize={20}
        maxSize={80}
      />,
    )
    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(separator).toHaveAttribute('aria-valuenow', '20')
  })

  it('reports controlled size changes without mutating internal state', async () => {
    const onSizeChange = vi.fn()
    render(
      <SplitPane primary={<div />} secondary={<div />} size={50} onSizeChange={onSizeChange} />,
    )
    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSizeChange).toHaveBeenCalledWith(52)
    expect(separator).toHaveAttribute('aria-valuenow', '50')
  })

  it('supports a vertical layout with the opposite orientation', () => {
    render(<SplitPane primary={<div />} secondary={<div />} direction="vertical" />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
  })
})

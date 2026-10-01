import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Progress } from '../src/index.js'

describe('Progress', () => {
  it('exposes determinate value bounds', () => {
    render(<Progress label="Upload" value={30} max={60} />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '60')
    expect(bar).toHaveAttribute('aria-valuenow', '30')
  })

  it('omits aria-valuenow when indeterminate', () => {
    render(<Progress label="Loading" indeterminate />)
    expect(screen.getByRole('progressbar', { name: 'Loading' })).not.toHaveAttribute(
      'aria-valuenow',
    )
  })

  it('clamps out-of-range values and can show the percentage', () => {
    render(<Progress label="Upload" value={150} max={100} showValue />)
    expect(screen.getByRole('progressbar', { name: 'Upload' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('accepts an aria-label fallback', () => {
    render(<Progress aria-label="Indexing" value={10} />)
    expect(screen.getByRole('progressbar', { name: 'Indexing' })).toBeInTheDocument()
  })

  it('normalizes invalid maxima and non-finite values to a valid ARIA range', () => {
    render(<Progress label="Upload" value={Infinity} max={Number.NaN} showValue />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('uses a positive fallback when max is zero or negative', () => {
    render(<Progress label="Upload" value={25} max={0} />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '25')
  })
})

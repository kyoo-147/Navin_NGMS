import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox } from '../src/index.js'

describe('Checkbox', () => {
  it('is labelled and toggles on activation', async () => {
    render(<Checkbox label="Remember me" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Remember me' })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it('exposes the indeterminate state as aria-checked="mixed"', () => {
    render(<Checkbox label="Select all" indeterminate />)
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' })
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    expect((checkbox as HTMLInputElement).indeterminate).toBe(true)
  })

  it('announces validation errors', () => {
    render(<Checkbox label="Terms" error="You must accept the terms" />)
    expect(screen.getByRole('alert')).toHaveTextContent('You must accept the terms')
    expect(screen.getByRole('checkbox', { name: 'Terms' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('can be disabled', () => {
    render(<Checkbox label="Terms" disabled />)
    expect(screen.getByRole('checkbox', { name: 'Terms' })).toBeDisabled()
  })
})

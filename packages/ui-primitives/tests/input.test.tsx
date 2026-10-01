import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Input } from '../src/index.js'

describe('Input', () => {
  it('associates the label and exposes the required state', () => {
    render(<Input label="Email" required />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-required', 'true')
  })

  it('wires description and error through aria-describedby and aria-invalid', () => {
    render(<Input label="Email" description="Work address" error="Invalid email" />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy).toContain('-description')
    expect(describedBy).toContain('-error')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email')
  })

  it('accepts typed input', async () => {
    render(<Input label="Email" />)
    const input = screen.getByLabelText(/Email/)
    await userEvent.type(input, 'a@b.co')
    expect(input).toHaveValue('a@b.co')
  })

  it('supports the disabled state', () => {
    render(<Input label="Email" disabled />)
    expect(screen.getByLabelText(/Email/)).toBeDisabled()
  })

  it('applies className to the input and wrapperClassName to the field shell', () => {
    render(<Input label="Email" className="input-custom" wrapperClassName="wrapper-custom" />)
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveClass('input-custom')
    expect(input.parentElement).toHaveClass('wrapper-custom')
  })
})

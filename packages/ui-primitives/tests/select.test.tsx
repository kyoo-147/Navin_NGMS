import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Select } from '../src/index.js'

const options = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
]

describe('Select', () => {
  it('is named by its label and renders its options', () => {
    render(<Select label="Role" placeholder="Choose a role" options={options} />)
    expect(screen.getByLabelText(/Role/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Member' })).toBeInTheDocument()
  })

  it('allows selecting an option', async () => {
    render(<Select label="Role" options={options} />)
    await userEvent.selectOptions(screen.getByLabelText(/Role/), 'member')
    expect(screen.getByLabelText(/Role/)).toHaveValue('member')
  })

  it('marks the invalid state', () => {
    render(<Select label="Role" error="Role is required" options={[]} />)
    expect(screen.getByLabelText(/Role/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('can be disabled', () => {
    render(<Select label="Role" disabled options={options} />)
    expect(screen.getByLabelText(/Role/)).toBeDisabled()
  })
})

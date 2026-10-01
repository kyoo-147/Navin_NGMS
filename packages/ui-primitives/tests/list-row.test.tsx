import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { List, ListRow } from '../src/index.js'

describe('List / ListRow', () => {
  it('renders a plain list by default', () => {
    render(
      <List aria-label="Folders">
        <ListRow title="Inbox" />
        <ListRow title="Sent" />
      </List>,
    )
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders a selectable listbox with a selected option', () => {
    render(
      <List selectable aria-label="Labels">
        <ListRow title="Work" selected />
        <ListRow title="Home" />
      </List>,
    )
    expect(screen.getByRole('listbox', { name: 'Labels' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates options with the arrow keys', async () => {
    render(
      <List selectable aria-label="Labels">
        <ListRow title="One" />
        <ListRow title="Two" />
        <ListRow title="Three" />
      </List>,
    )
    const options = screen.getAllByRole('option')
    options[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(options[1]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(options[2]).toHaveFocus()
  })

  it('skips disabled options and activates on Enter', async () => {
    const onActivate = vi.fn()
    render(
      <List selectable aria-label="Labels">
        <ListRow title="One" />
        <ListRow title="Two" disabled />
        <ListRow title="Three" onActivate={onActivate} />
      </List>,
    )
    const options = screen.getAllByRole('option')
    options[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(options[2]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('makes a clickable plain row a keyboard-accessible button', async () => {
    const onActivate = vi.fn()
    render(
      <List aria-label="Folders">
        <ListRow title="Inbox" onActivate={onActivate} />
      </List>,
    )
    const row = screen.getByRole('button', { name: 'Inbox' })
    expect(row).toHaveAttribute('tabindex', '0')

    row.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('moves roving focus to the next enabled option when the active row is disabled', async () => {
    const { rerender } = render(
      <List selectable aria-label="Labels">
        <ListRow title="One" />
        <ListRow title="Two" />
        <ListRow title="Three" />
      </List>,
    )
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('tabindex', '0')
    options[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('tabindex', '0')

    rerender(
      <List selectable aria-label="Labels">
        <ListRow title="One" />
        <ListRow title="Two" disabled />
        <ListRow title="Three" />
      </List>,
    )

    expect(options[1]).toHaveAttribute('tabindex', '-1')
    expect(options[2]).toHaveAttribute('tabindex', '0')
    expect(options[2]).toHaveFocus()
  })

  it('keeps disabled clickable rows out of the tab order and inactive', async () => {
    const onActivate = vi.fn()
    render(
      <List aria-label="Folders">
        <ListRow title="Inbox" disabled onActivate={onActivate} />
      </List>,
    )
    const row = screen.getByRole('button', { name: 'Inbox' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAttribute('tabindex', '-1')

    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('renders long titles with a title attribute for truncation', () => {
    const long = 'A very long folder name that should truncate gracefully inside the row'
    render(
      <List aria-label="Folders">
        <ListRow title={long} />
      </List>,
    )
    expect(screen.getByText(long)).toHaveAttribute('title', long)
  })
})

import React, { useState } from 'react'
import { parseSearchQuery } from '@navin/mail-core'

export interface SearchBarProps {
  onSearch: (query: string) => void
  initialQuery?: string
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, initialQuery = '' }) => {
  const [query, setQuery] = useState(initialQuery)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch(query)
  }

  const handleAddChip = (chip: string) => {
    const updated = query ? `${query} ${chip}` : chip
    setQuery(updated)
    onSearch(updated)
  }

  const parsed = parseSearchQuery(query)

  return (
    <form
      role="search"
      aria-label="Email search"
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#f1f5f9',
          borderRadius: '8px',
          padding: '6px 12px',
          border: '1px solid var(--navin-border)',
        }}
      >
        <span style={{ marginRight: '8px', color: 'var(--navin-text-muted)' }}>🔍</span>
        <input
          type="search"
          aria-label="Search mail"
          placeholder="Search mail (e.g. from:alice has:attachment is:unread)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '0.9rem',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              onSearch('')
            }}
            aria-label="Clear search"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--navin-text-muted)',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Quick filter chips & parsed chips */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        {parsed.chips.map((c, idx) => (
          <span
            key={idx}
            className="search-chip"
            style={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}
          >
            {c.key}:{c.value}
          </span>
        ))}

        <span style={{ fontSize: '0.75rem', color: 'var(--navin-text-muted)', marginLeft: '4px' }}>
          Quick:
        </span>
        <button
          type="button"
          onClick={() => handleAddChip('is:unread')}
          style={{
            fontSize: '0.75rem',
            padding: '2px 6px',
            borderRadius: '10px',
            border: '1px solid var(--navin-border)',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Unread
        </button>
        <button
          type="button"
          onClick={() => handleAddChip('has:attachment')}
          style={{
            fontSize: '0.75rem',
            padding: '2px 6px',
            borderRadius: '10px',
            border: '1px solid var(--navin-border)',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Attachments
        </button>
        <button
          type="button"
          onClick={() => handleAddChip('is:starred')}
          style={{
            fontSize: '0.75rem',
            padding: '2px 6px',
            borderRadius: '10px',
            border: '1px solid var(--navin-border)',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Starred
        </button>
      </div>
    </form>
  )
}

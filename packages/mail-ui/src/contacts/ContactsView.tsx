import React, { useState } from 'react'
import type { Contact, ContactsManager } from '@navin/mail-core'

export interface ContactsViewProps {
  contactsManager: ContactsManager
  accountId: string
}

export const ContactsView: React.FC<ContactsViewProps> = ({ contactsManager, accountId }) => {
  const [search, setSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [, setRefresh] = useState(0)

  const contacts = search.trim()
    ? contactsManager.autocomplete(search, accountId)
    : contactsManager.listContacts(accountId)
  const duplicates = contactsManager.findDuplicates(accountId)

  const handleSelect = (c: Contact) => {
    setSelectedContact(c)
    setIsEditing(false)
  }

  const handleStartCreate = () => {
    setSelectedContact(null)
    setFormName('')
    setFormEmail('')
    setFormPhone('')
    setFormCompany('')
    setFormNotes('')
    setIsEditing(true)
  }

  const handleSave = () => {
    if (!formName || !formEmail) return
    if (selectedContact) {
      contactsManager.updateContact(selectedContact.id, {
        name: formName,
        email: formEmail,
        phone: formPhone || undefined,
        company: formCompany || undefined,
        notes: formNotes || undefined,
      })
    } else {
      contactsManager.createContact(accountId, {
        name: formName,
        email: formEmail,
        phone: formPhone || undefined,
        company: formCompany || undefined,
        notes: formNotes || undefined,
        groups: ['general'],
      })
    }
    setIsEditing(false)
    setRefresh((r) => r + 1)
  }

  const handleDelete = (id: string) => {
    contactsManager.deleteContact(id)
    setSelectedContact(null)
    setRefresh((r) => r + 1)
  }

  const handleMergeDuplicates = (_email: string, contactList: Contact[]) => {
    if (contactList.length < 2) return
    const primary = contactList[0]!
    for (let i = 1; i < contactList.length; i++) {
      contactsManager.mergeContacts(primary.id, contactList[i]!.id)
    }
    setRefresh((r) => r + 1)
  }

  const handleExportVCard = () => {
    const vcard = contactsManager.exportVCard(accountId)
    const blob = new Blob([vcard], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts_${accountId}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left List Pane */}
      <div
        style={{
          width: '320px',
          borderRight: '1px solid var(--navin-border)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--navin-surface)',
        }}
      >
        <div
          style={{
            padding: '12px',
            borderBottom: '1px solid var(--navin-border)',
            display: 'flex',
            gap: '8px',
          }}
        >
          <input
            type="search"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid var(--navin-border)',
            }}
          />
          <button
            type="button"
            onClick={handleStartCreate}
            style={{
              padding: '6px 12px',
              background: 'var(--navin-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + Add
          </button>
        </div>

        {/* Duplicates Banner */}
        {duplicates.length > 0 && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef3c7',
              fontSize: '0.8rem',
              borderBottom: '1px solid #f59e0b',
            }}
          >
            <span>⚠️ {duplicates.length} duplicate email(s) found.</span>
            {duplicates.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => handleMergeDuplicates(d.email, d.contacts)}
                style={{ marginLeft: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                Merge ({d.email})
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            padding: '8px 12px',
            display: 'flex',
            gap: '8px',
            borderBottom: '1px solid var(--navin-border)',
          }}
        >
          <button
            type="button"
            onClick={handleExportVCard}
            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
          >
            ⬇ Export vCard
          </button>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1 }}>
          {contacts.map((c) => (
            <li
              key={c.id}
              onClick={() => handleSelect(c)}
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--navin-border)',
                cursor: 'pointer',
                backgroundColor: selectedContact?.id === c.id ? '#e0f2fe' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--navin-text-muted)' }}>{c.email}</div>
            </li>
          ))}
          {contacts.length === 0 && (
            <li style={{ padding: '20px', textAlign: 'center', color: 'var(--navin-text-muted)' }}>
              No contacts found
            </li>
          )}
        </ul>
      </div>

      {/* Right Details Pane */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: 'var(--navin-bg)' }}>
        {isEditing ? (
          <div
            style={{
              maxWidth: '480px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#fff',
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid var(--navin-border)',
            }}
          >
            <h3>{selectedContact ? 'Edit Contact' : 'New Contact'}</h3>
            <label>
              Name:
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Email:
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Phone:
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Company:
              <input
                type="text"
                value={formCompany}
                onChange={(e) => setFormCompany(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <label>
              Notes:
              <textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                style={{ width: '100%', padding: '6px', marginTop: '4px' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: '8px 16px',
                  background: 'var(--navin-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                style={{
                  padding: '8px 16px',
                  background: 'none',
                  border: '1px solid var(--navin-border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : selectedContact ? (
          <div
            style={{
              maxWidth: '480px',
              background: '#fff',
              padding: '24px',
              borderRadius: '8px',
              border: '1px solid var(--navin-border)',
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
              <div>
                <h2 style={{ margin: '0 0 4px 0' }}>{selectedContact.name}</h2>
                <div style={{ color: 'var(--navin-text-muted)' }}>{selectedContact.email}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setFormName(selectedContact.name)
                    setFormEmail(selectedContact.email)
                    setFormPhone(selectedContact.phone || '')
                    setFormCompany(selectedContact.company || '')
                    setFormNotes(selectedContact.notes || '')
                    setIsEditing(true)
                  }}
                  style={{ padding: '6px 12px', cursor: 'pointer' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selectedContact.id)}
                  style={{ padding: '6px 12px', color: '#ef4444', cursor: 'pointer' }}
                >
                  Delete
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                fontSize: '0.9rem',
              }}
            >
              {selectedContact.phone && (
                <div>
                  <strong>Phone:</strong> {selectedContact.phone}
                </div>
              )}
              {selectedContact.company && (
                <div>
                  <strong>Company:</strong> {selectedContact.company}
                </div>
              )}
              {selectedContact.groups.length > 0 && (
                <div>
                  <strong>Groups:</strong>{' '}
                  {selectedContact.groups.map((g) => (
                    <span
                      key={g}
                      style={{
                        background: '#f1f5f9',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginRight: '4px',
                        fontSize: '0.8rem',
                      }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {selectedContact.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: '4px', color: '#334155' }}>
                    {selectedContact.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--navin-text-muted)', textAlign: 'center', marginTop: '40px' }}>
            Select a contact to view details or click + Add to create one.
          </div>
        )}
      </div>
    </div>
  )
}

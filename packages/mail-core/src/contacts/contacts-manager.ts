import { generateUUID } from '../utils/uuid.js'

export interface Contact {
  id: string
  accountId: string
  name: string
  email: string
  phone?: string
  company?: string
  notes?: string
  groups: string[]
  updatedAt: string
}

export class ContactsManager {
  private readonly contacts = new Map<string, Contact>()

  constructor(initialContacts: Contact[] = []) {
    for (const c of initialContacts) {
      this.contacts.set(c.id, c)
    }
  }

  createContact(accountId: string, data: Omit<Contact, 'id' | 'accountId' | 'updatedAt'>): Contact {
    const contact: Contact = {
      ...data,
      id: generateUUID(),
      accountId,
      updatedAt: new Date().toISOString(),
    }
    this.contacts.set(contact.id, contact)
    return contact
  }

  updateContact(id: string, updates: Partial<Omit<Contact, 'id' | 'accountId'>>): Contact {
    const existing = this.contacts.get(id)
    if (!existing) {
      throw new Error(`Contact with id ${id} not found`)
    }
    const updated: Contact = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    this.contacts.set(id, updated)
    return updated
  }

  deleteContact(id: string): boolean {
    return this.contacts.delete(id)
  }

  getContact(id: string): Contact | undefined {
    return this.contacts.get(id)
  }

  listContacts(accountId?: string): Contact[] {
    const list = Array.from(this.contacts.values())
    if (!accountId) return list
    return list.filter((c) => c.accountId === accountId)
  }

  /**
   * Autocomplete matching contact names or email addresses.
   */
  autocomplete(query: string, accountId?: string): Contact[] {
    const q = query.toLowerCase().trim()
    if (!q) return []
    return this.listContacts(accountId).filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    )
  }

  /**
   * Identifies duplicate contacts by normalized email address.
   */
  findDuplicates(accountId?: string): Array<{ email: string; contacts: Contact[] }> {
    const map = new Map<string, Contact[]>()
    for (const c of this.listContacts(accountId)) {
      const email = c.email.toLowerCase()
      const list = map.get(email) ?? []
      list.push(c)
      map.set(email, list)
    }

    const duplicates: Array<{ email: string; contacts: Contact[] }> = []
    for (const [email, list] of map.entries()) {
      if (list.length > 1) {
        duplicates.push({ email, contacts: list })
      }
    }
    return duplicates
  }

  /**
   * Merges secondary contact into primary, combining groups and notes.
   */
  mergeContacts(primaryId: string, secondaryId: string): Contact {
    const primary = this.contacts.get(primaryId)
    const secondary = this.contacts.get(secondaryId)
    if (!primary || !secondary) {
      throw new Error('Both contacts must exist to merge')
    }

    const mergedGroups = Array.from(new Set([...primary.groups, ...secondary.groups]))
    const mergedNotes = [primary.notes, secondary.notes].filter(Boolean).join('\n---\n')

    const updated: Contact = {
      ...primary,
      phone: primary.phone || secondary.phone,
      company: primary.company || secondary.company,
      notes: mergedNotes || undefined,
      groups: mergedGroups,
      updatedAt: new Date().toISOString(),
    }

    this.contacts.set(primaryId, updated)
    this.contacts.delete(secondaryId)
    return updated
  }

  /**
   * Exports contacts to vCard RFC 6350 standard format.
   */
  exportVCard(accountId?: string): string {
    const cards: string[] = []
    for (const c of this.listContacts(accountId)) {
      const lines: string[] = ['BEGIN:VCARD', 'VERSION:4.0', `FN:${c.name}`, `EMAIL:${c.email}`]
      if (c.phone) lines.push(`TEL:${c.phone}`)
      if (c.company) lines.push(`ORG:${c.company}`)
      if (c.notes) lines.push(`NOTE:${c.notes}`)
      if (c.groups.length > 0) lines.push(`CATEGORIES:${c.groups.join(',')}`)
      lines.push('END:VCARD')
      cards.push(lines.join('\r\n'))
    }
    return cards.join('\r\n\r\n')
  }

  /**
   * Parses vCard text and adds contacts to the manager.
   */
  importVCard(vcardText: string, accountId: string): Contact[] {
    const imported: Contact[] = []
    const cards = vcardText.split(/BEGIN:VCARD/i).filter((s) => s.includes('END:VCARD'))

    for (const card of cards) {
      let name = ''
      let email = ''
      let phone: string | undefined
      let company: string | undefined
      let notes: string | undefined
      const groups: string[] = []

      const lines = card.split(/\r?\n/)
      for (const line of lines) {
        const [rawKey, ...valParts] = line.split(':')
        if (!rawKey || valParts.length === 0) continue
        const key = rawKey.split(';')[0]?.toUpperCase().trim()
        const val = valParts.join(':').trim()

        if (key === 'FN') name = val
        else if (key === 'EMAIL') email = val
        else if (key === 'TEL') phone = val
        else if (key === 'ORG') company = val
        else if (key === 'NOTE') notes = val
        else if (key === 'CATEGORIES') {
          groups.push(...val.split(',').map((g) => g.trim()))
        }
      }

      if (name && email) {
        const contact = this.createContact(accountId, {
          name,
          email,
          phone,
          company,
          notes,
          groups,
        })
        imported.push(contact)
      }
    }

    return imported
  }

  /**
   * Exports contacts to CSV.
   */
  exportCsv(accountId?: string): string {
    const rows = ['Name,Email,Phone,Company,Groups,Notes']
    for (const c of this.listContacts(accountId)) {
      const escape = (val?: string) => `"${(val ?? '').replace(/"/g, '""')}"`
      rows.push(
        `${escape(c.name)},${escape(c.email)},${escape(c.phone)},${escape(c.company)},${escape(c.groups.join(';'))},${escape(c.notes)}`,
      )
    }
    return rows.join('\r\n')
  }

  /**
   * Imports contacts from CSV.
   */
  importCsv(csvText: string, accountId: string): Contact[] {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) return []

    const imported: Contact[] = []
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      // Parse CSV line handling quotes
      const values: string[] = []
      let inQuote = false
      let cur = ''
      for (let j = 0; j < line.length; j++) {
        const char = line[j]
        if (char === '"') {
          if (inQuote && line[j + 1] === '"') {
            cur += '"'
            j++
          } else {
            inQuote = !inQuote
          }
        } else if (char === ',' && !inQuote) {
          values.push(cur)
          cur = ''
        } else {
          cur += char
        }
      }
      values.push(cur)

      const name = values[0]?.trim() ?? ''
      const email = values[1]?.trim() ?? ''
      const phone = values[2]?.trim() || undefined
      const company = values[3]?.trim() || undefined
      const groupsStr = values[4]?.trim() || ''
      const notes = values[5]?.trim() || undefined

      const groups = groupsStr ? groupsStr.split(';').map((g) => g.trim()) : []

      if (name && email) {
        const contact = this.createContact(accountId, {
          name,
          email,
          phone,
          company,
          notes,
          groups,
        })
        imported.push(contact)
      }
    }
    return imported
  }
}

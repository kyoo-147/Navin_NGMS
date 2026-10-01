import { computeItemFingerprint } from './fingerprint.js'
import type {
  DeltaPage,
  FolderInventory,
  ImapConnectorPort,
  ImapMailbox,
  InventoryItem,
  InventoryPage,
  JmapConnectorPort,
  JmapMailbox,
  MigrationSourceAdapter,
  SourceMessage,
} from './types.js'

interface PageCursor {
  folderIndex: number
  cursor?: string
}

function decodeCursor(cursor: string | undefined): PageCursor {
  if (cursor === undefined) return { folderIndex: 0 }
  const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('folderIndex' in parsed) ||
    typeof parsed.folderIndex !== 'number'
  ) {
    throw new Error('Invalid source inventory cursor')
  }
  return parsed as PageCursor
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export class ImapSourceAdapter implements MigrationSourceAdapter {
  readonly protocol = 'imap' as const
  private mailboxes?: ImapMailbox[]

  constructor(private readonly connector: ImapConnectorPort) {}

  async listFolders(): Promise<FolderInventory[]> {
    const mailboxes = await this.getMailboxes()
    return mailboxes.map((mailbox) => ({
      sourceFolderId: mailbox.sourceFolderId,
      name: mailbox.name,
      path: mailbox.path,
      totalItems: mailbox.exists,
    }))
  }

  async inventory(cursor?: string): Promise<InventoryPage> {
    const mailboxes = await this.getMailboxes()
    const position = decodeCursor(cursor)
    const mailbox = mailboxes[position.folderIndex]
    if (mailbox === undefined) return { items: [] }
    const page = await this.connector.listUids(mailbox, position.cursor)
    const items = page.items.map((item) => ({
      ...item,
      fingerprint: item.fingerprint ?? computeItemFingerprint(item),
    }))
    if (page.nextCursor !== undefined) {
      return {
        items,
        nextCursor: encodeCursor({ folderIndex: position.folderIndex, cursor: page.nextCursor }),
      }
    }
    return {
      items,
      nextCursor:
        position.folderIndex + 1 < mailboxes.length
          ? encodeCursor({ folderIndex: position.folderIndex + 1 })
          : undefined,
    }
  }

  async fetchMessage(item: InventoryItem): Promise<SourceMessage> {
    const mailbox = (await this.getMailboxes()).find(
      (candidate) => candidate.sourceFolderId === item.sourceFolderId,
    )
    if (mailbox === undefined || item.sourceUid === undefined) {
      throw new Error(`IMAP item ${item.sourceFolderId} has no fetchable UID`)
    }
    return this.connector.fetchMessage(mailbox, item.sourceUid)
  }

  async delta(cursor?: string): Promise<DeltaPage> {
    const mailboxes = await this.getMailboxes()
    const position = decodeCursor(cursor)
    const mailbox = mailboxes[position.folderIndex]
    if (mailbox === undefined || this.connector.fetchChanges === undefined)
      return { items: [], deleted: [] }
    const page = await this.connector.fetchChanges(mailbox, position.cursor)
    if (page.nextCursor !== undefined) {
      return {
        ...page,
        nextCursor: encodeCursor({ folderIndex: position.folderIndex, cursor: page.nextCursor }),
      }
    }
    return {
      ...page,
      nextCursor:
        position.folderIndex + 1 < mailboxes.length
          ? encodeCursor({ folderIndex: position.folderIndex + 1 })
          : undefined,
    }
  }

  private async getMailboxes(): Promise<ImapMailbox[]> {
    this.mailboxes ??= await this.connector.listMailboxes()
    return this.mailboxes
  }
}

export class JmapSourceAdapter implements MigrationSourceAdapter {
  readonly protocol = 'jmap' as const
  private mailboxes?: JmapMailbox[]
  private deltaState?: string

  constructor(private readonly connector: JmapConnectorPort) {}

  async listFolders(): Promise<FolderInventory[]> {
    const mailboxes = await this.getMailboxes()
    return mailboxes.map((mailbox) => ({
      sourceFolderId: mailbox.sourceFolderId,
      name: mailbox.name,
      totalItems: mailbox.totalEmails,
    }))
  }

  async inventory(cursor?: string): Promise<InventoryPage> {
    const mailboxes = await this.getMailboxes()
    const position = decodeCursor(cursor)
    const mailbox = mailboxes[position.folderIndex]
    if (mailbox === undefined) return { items: [] }
    const page = await this.connector.queryEmails(mailbox, position.cursor)
    const items = page.items.map((item) => ({
      ...item,
      fingerprint: item.fingerprint ?? computeItemFingerprint(item),
    }))
    if (page.nextCursor !== undefined) {
      return {
        items,
        nextCursor: encodeCursor({ folderIndex: position.folderIndex, cursor: page.nextCursor }),
      }
    }
    return {
      items,
      nextCursor:
        position.folderIndex + 1 < mailboxes.length
          ? encodeCursor({ folderIndex: position.folderIndex + 1 })
          : undefined,
    }
  }

  async fetchMessage(item: InventoryItem): Promise<SourceMessage> {
    if (item.sourceId === undefined) throw new Error('JMAP item has no message id')
    return this.connector.getMessage(item.sourceId)
  }

  async delta(cursor?: string): Promise<DeltaPage> {
    if (this.connector.changes === undefined) return { items: [], deleted: [] }
    const result = await this.connector.changes(cursor ?? this.deltaState)
    this.deltaState = result.newState ?? result.nextCursor
    return {
      items: result.items,
      deleted: result.deleted,
      nextCursor: result.newState ?? result.nextCursor,
    }
  }

  private async getMailboxes(): Promise<JmapMailbox[]> {
    this.mailboxes ??= await this.connector.listMailboxes()
    return this.mailboxes
  }
}

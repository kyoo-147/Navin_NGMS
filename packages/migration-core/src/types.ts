export type MigrationProtocol = 'imap' | 'jmap'
export type MigrationItemState =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deleted'

export interface FolderInventory {
  sourceFolderId: string
  name: string
  path?: string
  totalItems: number
}

export interface InventoryItem {
  sourceFolderId: string
  sourceUid?: number
  sourceId?: string
  messageId?: string
  fingerprint?: string
  receivedAt?: string
  size?: number
}

export interface InventoryPage {
  items: InventoryItem[]
  nextCursor?: string
}

export interface AttachmentPayload {
  filename: string
  contentType: string
  content: Uint8Array
  contentId?: string
  disposition?: string
}

export interface SourceMessage {
  identity: InventoryItem
  rawRfc822: Uint8Array
  flags: string[]
  labels: string[]
  internalDate?: string
  receivedAt?: string
  attachments: AttachmentPayload[]
  metadata: Record<string, unknown>
}

export interface DeltaPage {
  items: InventoryItem[]
  deleted: InventoryItem[]
  nextCursor?: string
}

export interface ReconcileResult {
  items: InventoryItem[]
  deleted: InventoryItem[]
}

export interface MigrationSourceAdapter {
  readonly protocol: MigrationProtocol
  listFolders(): Promise<FolderInventory[]>
  inventory(cursor?: string): Promise<InventoryPage>
  fetchMessage(item: InventoryItem): Promise<SourceMessage>
  delta(cursor?: string): Promise<DeltaPage>
  reconcile?(): Promise<ReconcileResult>
}

export interface MigrationTargetPort {
  upsertMessage(message: SourceMessage, idempotencyKey: string): Promise<{ targetId: string }>
  deleteMessage?(identity: InventoryItem, idempotencyKey: string): Promise<void>
}

export interface ImapMailbox {
  sourceFolderId: string
  name: string
  path: string
  uidValidity: number
  exists: number
}

export interface ImapConnectorPort {
  listMailboxes(): Promise<ImapMailbox[]>
  listUids(mailbox: ImapMailbox, cursor?: string): Promise<InventoryPage>
  fetchMessage(mailbox: ImapMailbox, uid: number): Promise<SourceMessage>
  fetchChanges?(mailbox: ImapMailbox, cursor?: string): Promise<DeltaPage>
}

export interface JmapMailbox {
  sourceFolderId: string
  name: string
  role?: string
  totalEmails: number
}

export interface JmapConnectorPort {
  listMailboxes(): Promise<JmapMailbox[]>
  queryEmails(mailbox: JmapMailbox, position?: string): Promise<InventoryPage>
  getMessage(messageId: string): Promise<SourceMessage>
  changes?(sinceState?: string): Promise<DeltaPage & { newState?: string }>
}

export interface MigrationRunOptions {
  concurrency?: number
  signal?: AbortSignal
  resume?: boolean
}

export interface MigrationSummary {
  migrationId: string
  status: 'completed' | 'failed' | 'cancelled'
  baselineImported: number
  deltaImported: number
  reconciled: number
  deleted: number
  duplicatePrevented: number
  failures: MigrationFailure[]
  cancellationRequested: boolean
}

export interface MigrationFailure {
  itemKey: string
  phase: 'baseline' | 'delta' | 'reconcile' | 'delete'
  code:
    | 'SOURCE_FETCH_FAILED'
    | 'TARGET_WRITE_FAILED'
    | 'TARGET_DELETE_FAILED'
    | 'INVALID_ITEM'
    | 'CANCELLED'
  message: string
  retryable: boolean
}

export interface MigrationRecord {
  id: string
  protocol: MigrationProtocol
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled'
  baselineCursor?: string
  baselineDone: boolean
  deltaCursor?: string
  cancellationRequested: boolean
  concurrency: number
  counters: Omit<MigrationSummary, 'migrationId' | 'status' | 'failures' | 'cancellationRequested'>
  failures: MigrationFailure[]
}

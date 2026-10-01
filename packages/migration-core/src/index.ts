export { ImapSourceAdapter, JmapSourceAdapter } from './adapters.js'
export { MigrationCore } from './engine.js'
export type { MigrationCoreOptions } from './engine.js'
export {
  computeFingerprint,
  computeItemFingerprint,
  computeMessageFingerprint,
} from './fingerprint.js'
export { asErrorMessage, isAbortRequested, itemKey, MigrationStore } from './store.js'
export type {
  AttachmentPayload,
  DeltaPage,
  FolderInventory,
  ImapConnectorPort,
  ImapMailbox,
  InventoryItem,
  InventoryPage,
  JmapConnectorPort,
  JmapMailbox,
  MigrationFailure,
  MigrationItemState,
  MigrationProtocol,
  MigrationRecord,
  MigrationRunOptions,
  MigrationSourceAdapter,
  MigrationSummary,
  MigrationTargetPort,
  ReconcileResult,
  SourceMessage,
} from './types.js'
export type { MigrationItemStateRecord } from './store.js'

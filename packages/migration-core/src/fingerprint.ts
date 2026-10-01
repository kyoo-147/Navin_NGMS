import { createHash } from 'node:crypto'
import type { InventoryItem, SourceMessage } from './types.js'

export function computeMessageFingerprint(message: SourceMessage): string {
  if (message.identity.fingerprint && message.identity.fingerprint.trim().length > 0) {
    return message.identity.fingerprint
  }
  if (message.rawRfc822 && message.rawRfc822.byteLength > 0) {
    return createHash('sha256').update(message.rawRfc822).digest('hex')
  }
  return computeItemFingerprint(message.identity)
}

export function computeItemFingerprint(item: InventoryItem): string {
  if (item.fingerprint && item.fingerprint.trim().length > 0) {
    return item.fingerprint
  }
  if (item.messageId && item.messageId.trim().length > 0) {
    return createHash('sha256').update(`msgid:${item.messageId.trim().toLowerCase()}`).digest('hex')
  }
  const identity =
    item.sourceUid !== undefined ? `uid:${item.sourceUid}` : `id:${item.sourceId ?? 'unknown'}`
  return createHash('sha256').update(`source:${item.sourceFolderId}:${identity}`).digest('hex')
}

export function computeFingerprint(item: InventoryItem, rawRfc822?: Uint8Array): string {
  if (rawRfc822 && rawRfc822.byteLength > 0) {
    return createHash('sha256').update(rawRfc822).digest('hex')
  }
  return computeItemFingerprint(item)
}

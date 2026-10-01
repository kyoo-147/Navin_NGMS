import type { MessageId, ThreadId } from '@navin/contracts'
import type { JmapThread } from '../jmap/types.js'
import { encodeId } from './id.js'

export interface NormalizedThread {
  id: ThreadId
  messageIds: MessageId[]
}

export function toNormalizedThread(thread: JmapThread): NormalizedThread {
  return {
    id: encodeId('thd', thread.id) as ThreadId,
    messageIds: thread.emailIds.map((emailId) => encodeId('msg', emailId) as MessageId),
  }
}

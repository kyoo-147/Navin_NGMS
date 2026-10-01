import type { NotificationInput } from './types'

const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 1000

export function normalizeNotification(input: NotificationInput): NotificationInput {
  const title = input.title.trim()
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new Error('notification title must be 1..120 characters')
  }
  const body = input.body?.trim()
  if (body !== undefined && body.length > MAX_BODY_LENGTH) {
    throw new Error(`notification body must be at most ${MAX_BODY_LENGTH} characters`)
  }
  return { title, body }
}

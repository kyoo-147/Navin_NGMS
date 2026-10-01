import { ApiResponseTooLargeError, type ApiErrorContext } from './errors.js'
import type { TransportResponse } from './transport.js'

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength
}

/**
 * Reads a response body while enforcing a hard byte cap. Prefers the streaming body so a hostile
 * or misbehaving server cannot force an unbounded `text()` allocation.
 */
export async function readBoundedText(
  response: TransportResponse,
  maxBytes: number,
  context: ApiErrorContext = {},
): Promise<string> {
  const body = response.body
  if (!body) {
    const text = await response.text()
    if (utf8ByteLength(text) > maxBytes) {
      throw new ApiResponseTooLargeError(`Response body exceeded ${maxBytes} bytes`, {
        ...context,
        limitBytes: maxBytes,
      })
    }
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel()
          } catch {
            // Stream may already be closed.
          }
          throw new ApiResponseTooLargeError(`Response body exceeded ${maxBytes} bytes`, {
            ...context,
            limitBytes: maxBytes,
          })
        }
        text += decoder.decode(value, { stream: true })
      }
    }
    text += decoder.decode()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Reader may already be released.
    }
  }
  return text
}

/** Truncates text to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateText(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || utf8ByteLength(text) <= maxBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8ByteLength(text.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return text.slice(0, low)
}

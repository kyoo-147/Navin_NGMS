import type { Readable } from 'node:stream'

export const MAX_PASSWORD_INPUT_BYTES = 8192

/**
 * Reads exactly one password line from `stream`.
 *
 * Only the line terminator is stripped (`\n`, or `\r\n` when it is the
 * terminator); every other byte is preserved verbatim, so a password is never
 * trimmed or normalized. Reading stops at the first line terminator and is
 * bounded by `maxBytes`, so a piped stream cannot exhaust memory or hang. The
 * value is never written to stdout/stderr by this module.
 */
export function readPasswordLine(
  stream: Readable,
  options: { maxBytes?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_PASSWORD_INPUT_BYTES
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const cleanup = (): void => {
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
    }
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onData = (chunk: Buffer | string): void => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const newline = buf.indexOf(0x0a)
      if (newline >= 0) {
        // Only the bytes up to the terminator count against the bound, so a
        // short first line followed by oversized trailing data in the same
        // chunk is still exactly one bounded line.
        if (total + newline > maxBytes) {
          settle(() => reject(new Error('Password input exceeds the maximum length')))
          return
        }
        let line = Buffer.concat([...chunks, buf.subarray(0, newline)])
        if (line.length > 0 && line[line.length - 1] === 0x0d) {
          line = line.subarray(0, line.length - 1)
        }
        settle(() => resolve(line.toString('utf8')))
        return
      }
      total += buf.length
      if (total > maxBytes) {
        settle(() => reject(new Error('Password input exceeds the maximum length')))
        return
      }
      chunks.push(buf)
    }
    const onEnd = (): void => settle(() => resolve(Buffer.concat(chunks).toString('utf8')))
    const onError = (error: Error): void => settle(() => reject(error))

    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
  })
}

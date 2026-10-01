const CR = 0x0d
const LF = 0x0a

/**
 * An append-only byte queue with an incremental CRLF scan. It keeps incoming
 * socket chunks as-is (no per-chunk concatenation), so draining a multi-megabyte
 * IMAP literal does not degrade quadratically.
 */
export class ChunkBuffer {
  private chunks: Buffer[] = []
  private length = 0

  get size(): number {
    return this.length
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  /** Returns the absolute index of the CR in the first CRLF pair, or -1. */
  findCrlf(): number {
    let index = 0
    let previousEndedWithCr = false
    for (const chunk of this.chunks) {
      if (previousEndedWithCr && chunk.length > 0 && chunk[0] === LF) {
        return index - 1
      }
      for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i] === CR && i + 1 < chunk.length && chunk[i + 1] === LF) {
          return index + i
        }
      }
      previousEndedWithCr = chunk.length > 0 && chunk[chunk.length - 1] === CR
      index += chunk.length
    }
    return -1
  }

  /** Removes and returns the first `count` bytes. */
  consume(count: number): Buffer {
    if (count < 0 || count > this.length) {
      throw new RangeError(`Cannot consume ${count} bytes from a ${this.length}-byte buffer`)
    }
    const out = Buffer.allocUnsafe(count)
    let offset = 0
    while (offset < count) {
      const head = this.chunks[0]
      if (head === undefined) break
      const take = Math.min(head.length, count - offset)
      head.copy(out, offset, 0, take)
      offset += take
      if (take === head.length) this.chunks.shift()
      else this.chunks[0] = head.subarray(take)
    }
    this.length -= count
    return out
  }

  clear(): void {
    this.chunks = []
    this.length = 0
  }
}

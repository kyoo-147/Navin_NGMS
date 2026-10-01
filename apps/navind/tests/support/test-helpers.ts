import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Clock } from '../../src/ports/clock.js'
import type { LoggerSink } from '../../src/ports/logger.js'

export function createTempDir(prefix = 'navind-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows can refuse to delete files that are still memory-mapped by a
    // closing SQLite connection. Cleanup is best-effort in tests.
  }
}

export class FixedClock implements Clock {
  private current: Date

  constructor(initialIso = '2026-10-01T00:00:00.000Z') {
    this.current = new Date(initialIso)
  }

  now(): Date {
    return new Date(this.current)
  }

  nowIso(): string {
    return this.current.toISOString()
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }

  set(iso: string): void {
    this.current = new Date(iso)
  }
}

export class CaptureSink implements LoggerSink {
  readonly chunks: string[] = []

  write(chunk: string): void {
    this.chunks.push(chunk)
  }

  get lines(): string[] {
    return this.chunks.flatMap((chunk) => chunk.split('\n').filter((line) => line.length > 0))
  }

  records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

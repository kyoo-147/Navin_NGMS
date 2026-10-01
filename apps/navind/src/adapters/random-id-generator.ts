import { randomUUID } from 'node:crypto'
import type { IdGenerator } from '../ports/id-generator.js'

export class RandomIdGenerator implements IdGenerator {
  next(prefix = 'id'): string {
    const normalized = prefix.replace(/[^a-zA-Z0-9]/g, '') || 'id'
    return `${normalized}_${randomUUID()}`
  }
}

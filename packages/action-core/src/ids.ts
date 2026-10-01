import { randomUUID } from 'node:crypto'

export type LedgerIdPrefix = 'act' | 'pln' | 'app' | 'job' | 'evt' | 'evi' | 'aud' | 'att'

export type IdFactory = (prefix: LedgerIdPrefix) => string

/**
 * Generates contract-valid prefixed identifiers (e.g. `act_<uuid>`).
 * The random suffix keeps ids collision-resistant across processes and restarts.
 */
export const createId: IdFactory = (prefix) => `${prefix}_${randomUUID()}`

/**
 * Deterministic candidate for tests and single-process simulations where
 * ids only need to be unique within the process.
 */
export function createSequentialIdFactory(seed = 0): IdFactory {
  let counter = seed
  return (prefix) => {
    counter += 1
    return `${prefix}_${counter.toString(36).padStart(4, '0')}`
  }
}

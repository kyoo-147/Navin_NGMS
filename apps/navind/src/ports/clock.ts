/**
 * Clock port.
 *
 * Time is a dependency, never a hidden global. Kernel code reads time through
 * this port so tests can drive deterministic timestamps and so future domain
 * packages can share a single, auditable time source.
 */
export interface Clock {
  /** Current instant. */
  now(): Date
  /** Current instant as an ISO 8601 UTC timestamp. */
  nowIso(): string
}

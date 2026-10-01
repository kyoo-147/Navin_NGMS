export type Clock = () => Date

export const systemClock: Clock = () => new Date()

export function nowIso(clock: Clock): string {
  return clock().toISOString()
}

export function isExpired(expiresAt: string, now: Date): boolean {
  const parsed = Date.parse(expiresAt)
  return Number.isNaN(parsed) ? true : parsed <= now.getTime()
}

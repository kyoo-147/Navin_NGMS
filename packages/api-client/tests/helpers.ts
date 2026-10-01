export interface WaitForOptions {
  timeoutMs?: number
  intervalMs?: number
  message?: string
}

export async function waitFor(
  predicate: () => boolean,
  options: WaitForOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000
  const intervalMs = options.intervalMs ?? 5
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(options.message ?? 'waitFor timed out')
    }
    await delay(intervalMs)
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

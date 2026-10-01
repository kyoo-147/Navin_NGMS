import { describe, it, expect } from 'vitest'
import { combineAbortSignals, createTimeoutSignal, sleep } from '../src/index.js'

describe('abort signals', () => {
  it('fires the timeout signal and reports that it timed out', async () => {
    const timeout = createTimeoutSignal(10)
    expect(timeout.timedOut()).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(timeout.signal.aborted).toBe(true)
    expect(timeout.timedOut()).toBe(true)
    timeout.clear()
  })

  it('propagates a parent abort through combineAbortSignals', () => {
    const parent = new AbortController()
    const combined = combineAbortSignals([parent.signal])

    expect(combined.signal.aborted).toBe(false)
    parent.abort()
    expect(combined.signal.aborted).toBe(true)
    combined.clear()
  })

  it('rejects a pending sleep when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleep(10, controller.signal)).rejects.toThrow()
  })
})

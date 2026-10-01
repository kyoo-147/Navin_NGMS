import { describe, expect, it } from 'vitest'
import { detectRuntimePlatform } from '../src/shell/platform'

describe('runtime platform detection', () => {
  it('treats anything without the Tauri global as web', () => {
    expect(detectRuntimePlatform({})).toBe('web')
    expect(detectRuntimePlatform(null)).toBe('web')
    expect(detectRuntimePlatform(undefined)).toBe('web')
  })

  it('detects the Tauri global', () => {
    expect(detectRuntimePlatform({ __TAURI_INTERNALS__: {} })).toBe('tauri')
  })
})

export type RuntimePlatform = 'tauri' | 'web'

interface TauriGlobal {
  readonly __TAURI_INTERNALS__?: unknown
}

/**
 * The shell runs either inside the Tauri webview (native bridges available) or
 * as an ordinary browser bundle (web fallback). Detection is the only thing that
 * decides which adapter bundle is installed, so it must never guess optimistically:
 * anything that is not an explicit Tauri global is treated as the web platform.
 */
export function detectRuntimePlatform(scope: unknown = globalThis): RuntimePlatform {
  if (scope === null || typeof scope !== 'object') return 'web'
  return typeof (scope as TauriGlobal).__TAURI_INTERNALS__ === 'undefined' ? 'web' : 'tauri'
}

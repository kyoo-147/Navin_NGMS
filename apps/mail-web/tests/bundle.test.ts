// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Proves the Web app is actually runnable: a real Vite production build from
 * `index.html`, with no fixture/engine/account data baked into the bundle.
 */
describe('Navin Mail Web production bundle', () => {
  it('builds a runnable bundle from index.html without hard-coded account data', async () => {
    await build({ root: APP_ROOT, logLevel: 'silent' })

    const indexPath = join(APP_ROOT, 'dist', 'index.html')
    expect(existsSync(indexPath)).toBe(true)
    expect(readFileSync(indexPath, 'utf8')).toContain('<div id="root">')

    const assetsDir = join(APP_ROOT, 'dist', 'assets')
    expect(existsSync(assetsDir)).toBe(true)
    const jsAssets = readdirSync(assetsDir).filter((file) => file.endsWith('.js'))
    expect(jsAssets.length).toBeGreaterThan(0)

    const bundle = jsAssets.map((file) => readFileSync(join(assetsDir, file), 'utf8')).join('\n')
    expect(bundle.length).toBeGreaterThan(1000)

    // No upstream engine, account or credential material is baked into the app.
    expect(bundle).not.toContain('acc_company_01')
    expect(bundle).not.toContain('user@example.org')
    expect(bundle).not.toContain('NAVIN_MAIL_JMAP_AUTHORIZATION')
  }, 120_000)
})

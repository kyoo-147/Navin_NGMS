import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The auth package intentionally declares no external dependency so it never
// requires a workspace lockfile edit. Contract-conformance tests resolve the
// frozen `@navin/contracts` sources through this alias at test time only; the
// shipped build emits no runtime import of the contracts package.
export default defineConfig({
  resolve: {
    alias: {
      '@navin/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})

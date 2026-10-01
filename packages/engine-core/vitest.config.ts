import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // engine-core declares no third-party dependencies so the workspace lockfile
      // stays untouched. Contract types are consumed straight from the frozen
      // @navin/contracts source for local tests.
      '@navin/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})

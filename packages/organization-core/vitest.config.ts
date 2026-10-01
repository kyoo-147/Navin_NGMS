import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve sibling packages from source so the ledger/engine do not need a
      // prior build to run the organization-core contract tests.
      '@navin/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
      '@navin/action-core': fileURLToPath(new URL('../action-core/src/index.ts', import.meta.url)),
      '@navin/engine-core/testing': fileURLToPath(
        new URL('../engine-core/src/testing/index.ts', import.meta.url),
      ),
      '@navin/engine-core': fileURLToPath(new URL('../engine-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

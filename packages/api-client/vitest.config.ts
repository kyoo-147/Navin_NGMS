import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@navin/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)),
    },
  },
})

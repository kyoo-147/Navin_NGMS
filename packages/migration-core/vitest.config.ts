import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@navin/migration-core': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
})

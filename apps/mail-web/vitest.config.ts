import { defineConfig } from 'vitest/config'

process.env.NODE_ENV = 'test'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    env: { NODE_ENV: 'test' },
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
})

import { defineConfig } from 'vitest/config'

// React only exposes `act` in its development build, which is selected by NODE_ENV.
// Pin a non-production value so the jsdom suite behaves the same on every machine.
process.env.NODE_ENV = 'test'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
})

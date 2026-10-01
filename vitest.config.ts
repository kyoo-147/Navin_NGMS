import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: [
      ...configDefaults.exclude,
      'apps/**',
      'packages/**',
      'extensions/**',
      'tests/acceptance/**',
    ],
  },
})

import { defineConfig } from 'vite'

// Navin Mail Web is a real browser app. React JSX is compiled by Vite's
// built-in esbuild transform (automatic runtime), so no extra plugin is
// required for a production bundle.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})

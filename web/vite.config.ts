import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ command }) => ({
  // Built for GitHub Pages at ptra243.github.io/WhatsForDinner/; the dev server stays at /.
  base: command === 'build' ? '/WhatsForDinner/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
}))

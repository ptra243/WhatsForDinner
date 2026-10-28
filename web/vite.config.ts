import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * Writes sw.js into the build with the app shell to cache: every built file and everything
 * in public/. Its version is a hash of them, so a new build replaces the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle), ...readdirSync('public')].sort()
      const hash = createHash('sha256')
      for (const [name, file] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      for (const name of readdirSync('public').sort()) hash.update(name).update(readFileSync(`public/${name}`))
      const source = readFileSync('sw.js', 'utf8')
        .replace('self.__SHELL__', JSON.stringify(files))
        .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig(({ command }) => ({
  // Built for GitHub Pages at ptra243.github.io/WhatsForDinner/; the dev server stays at /.
  base: command === 'build' ? '/WhatsForDinner/' : '/',
  plugins: [react(), serviceWorker()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
}))

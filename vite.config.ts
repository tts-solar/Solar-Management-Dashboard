/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

const OFFLINE_FILE = 'solar-dashboard-offline.html'

// Offline build writes its single HTML under a distinct name so it can sit
// beside the demo build's index.html in dist/.
function renameOfflineHtml(): Plugin {
  return {
    name: 'rename-offline-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') return
      delete bundle['index.html']
      this.emitFile({ type: 'asset', fileName: OFFLINE_FILE, source: html.source })
    },
  }
}

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'
  return {
    base: './',
    plugins: [viteSingleFile(), ...(offline ? [renameOfflineHtml()] : [])],
    build: {
      target: 'es2020',
      assetsInlineLimit: 100000000,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 5000,
      // demo build runs first and cleans dist/; offline build adds its file beside it
      emptyOutDir: !offline,
    },
    test: {
      environment: 'node',
    },
  }
})

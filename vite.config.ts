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

// The offline file holds homeowner data: forbid every network request so the data cannot leave
// the machine even by a bug. Everything is inlined (JS/CSS, fonts as data:), so nothing else is needed.
// Saved copies keep it too, since they are built from the page's own startup HTML.
const OFFLINE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

// build only: the dev server needs network for HMR
function offlineCsp(): Plugin {
  return {
    name: 'offline-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: OFFLINE_CSP }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'
  return {
    base: './',
    plugins: [viteSingleFile(), ...(offline ? [offlineCsp(), renameOfflineHtml()] : [])],
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

/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { checkBundledModules } from './tools/privacy-check.mjs'
import { readOfflineHtmlB64 } from './tools/offline-embed.mjs'

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

// Both builds hold homeowner data (offline from a saved file, online from an import): forbid every
// network request so the data cannot leave the browser even by a bug. Everything is inlined
// (JS/CSS, fonts as data:), so nothing else is needed. Saved copies keep it too, since they are
// built from the page's own startup HTML.
const NETWORK_LOCK_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

// Applied to BOTH builds (offline + online). build only: the dev server needs network for HMR.
function networkLockCsp(): Plugin {
  return {
    name: 'network-lock-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: NETWORK_LOCK_CSP }, injectTo: 'head-prepend' },
    ],
  }
}

const STYLESHEET = /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/i

// CSS @import is inlined by PostCSS, which reads the file itself: it never becomes a module, so
// bundledDataGuard cannot see it. Every CSS file that reaches the page passes through here, however it was pulled in.
// Builds only (build.root is set by bundledDataGuard): the dev server publishes nothing.
function cssSourceGuard(offline: boolean, build: { root: string }) {
  return {
    postcssPlugin: 'css-source-guard',
    Once(css: { source?: { input: { file?: string } }; walk(cb: (node: { source?: { input: { file?: string } } }) => void): void }) {
      if (!build.root) return
      const files = new Set<string>()
      if (css.source?.input.file) files.add(css.source.input.file)
      css.walk((node) => {
        if (node.source?.input.file) files.add(node.source.input.file)
      })
      const problems = checkBundledModules([...files], { root: build.root, offline, expectAppCode: false })
      if (problems.length) throw new Error(`privacy guard (T-008):\n  - ${problems.join('\n  - ')}`)
    },
  }
}

// The repo and the demo site are public: fail the build if anything outside the allowlist was bundled
// (real CSVs, spreadsheets, exports…). Checks what Vite actually resolved, not how the import was written.
function bundledDataGuard(offline: boolean, build: { root: string }): Plugin {
  return {
    name: 'bundled-data-guard',
    apply: 'build',
    configResolved(c) {
      build.root = c.root
    },
    generateBundle(_options, bundle) {
      // modules that put code into the output; getModuleIds() also lists ones tree-shaken away
      // (the offline build loads the sample CSVs, then drops them)
      const ids: string[] = []
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue
        if (!out.modules) {
          ids.push(...this.getModuleIds()) // no per-module info: check everything loaded (stricter)
          break
        }
        for (const [id, m] of Object.entries(out.modules)) if (m.renderedLength > 0) ids.push(id)
      }
      // stylesheets add no JS (renderedLength 0) yet always land in the page: check every one loaded
      ids.push(...[...this.getModuleIds()].filter((id) => STYLESHEET.test(id.split('?')[0])))
      const problems = checkBundledModules(ids, { root: build.root, offline })
      if (problems.length) this.error(`privacy guard (T-008):\n  - ${problems.join('\n  - ')}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'
  const build = { root: '' } // set once a build starts
  return {
    base: './',
    // Demo build bakes in the blank offline build (base64) so the online app can hand it out as a download
    // (downloadBlankOffline); the offline build IS that file, so it embeds nothing. '' when not built yet.
    define: { __OFFLINE_HTML_B64__: JSON.stringify(readOfflineHtmlB64(offline)) },
    plugins: [viteSingleFile(), bundledDataGuard(offline, build), networkLockCsp(), ...(offline ? [renameOfflineHtml()] : [])],
    css: { postcss: { plugins: [cssSourceGuard(offline, build)] } },
    build: {
      target: 'es2020',
      assetsInlineLimit: 100000000,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 5000,
      // offline build runs first and cleans dist/; demo build adds index.html beside its file
      emptyOutDir: offline,
    },
    test: {
      environment: 'node',
    },
  }
})

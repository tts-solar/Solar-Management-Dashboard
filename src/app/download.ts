import { EMBED_ID, parseSnapshot, type Snapshot } from './store'

// Baked in by Vite `define` (see vite.config.ts): the blank offline build's HTML, base64-encoded.
// '' in the offline build and in dev before build:offline has run.
declare const __OFFLINE_HTML_B64__: string

/** File name the blank offline download is saved under (matches the offline build's own name in dist/). */
const OFFLINE_FILE_NAME = 'solar-dashboard-offline.html'

/**
 * "Download HTML": the app is one self-contained file, so the offline copy is the page's own
 * startup HTML plus the current data as a JSON <script>. The rendered DOM is never serialised.
 */

let pristine = ''

/** Call once at startup, after readEmbedded() and before anything renders into #app. */
export function capturePristine(doc: Document): void {
  pristine = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

// never write the closing tag literally: this code is itself inlined in a <script>
const CLOSE = '<\/script>'
const openTag = () => `<script type="application/json" id="${EMBED_ID}">`

/** JSON that is safe inside <script>: "<" is escaped so the data can never close the tag. */
export function snapshotTag(snap: Snapshot): string {
  const json = JSON.stringify(snap).replace(/</g, '\\u003c')
  return `${openTag()}${json}${CLOSE}`
}

/** Put the data just before the real </body> (the last one — the bundled code may contain the text). */
export function injectSnapshot(html: string, snap: Snapshot): string {
  const at = html.toLowerCase().lastIndexOf('</body>')
  const tag = snapshotTag(snap)
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at)
}

/** Inverse of injectSnapshot, used by tests and as a sanity check before saving. */
export function extractSnapshot(html: string): Snapshot | null {
  const start = html.lastIndexOf(openTag())
  if (start < 0) return null
  const from = start + openTag().length
  const end = html.indexOf(CLOSE, from)
  return end < 0 ? null : parseSnapshot(html.slice(from, end))
}

const pad = (n: number) => String(n).padStart(2, '0')
// Include the time (to the minute) so saving twice in one day no longer collides on the same name —
// which made the browser silently append "(1)" to the second file (L2).
export const downloadName = (d = new Date()): string =>
  `solar-dashboard-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`

/** Hand an HTML string to the browser as a download. Returns the file name. */
function triggerDownload(html: string, name: string): string {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return a.download
}

/** Build the offline file (carrying the loaded data) and hand it to the browser as a download. */
export function downloadHtml(snap: Snapshot): string {
  if (!pristine) throw new Error('capturePristine() was not called')
  const html = injectSnapshot(pristine, snap)
  if (!extractSnapshot(html)) throw new Error('embedded data failed to round-trip')
  return triggerDownload(html, downloadName())
}

/** True when the blank offline build was baked into this (demo) bundle. */
export function blankOfflineAvailable(): boolean {
  return Boolean(__OFFLINE_HTML_B64__)
}

/**
 * Demo build only: hand the client the blank, network-locked offline app — the real build:offline artifact,
 * so it starts empty (no sample, and nothing imported here: that lives only in this browser, never in the
 * baked-in string). Decoded UTF-8-safe because the HTML carries Thai text.
 */
export function downloadBlankOffline(): string {
  if (!__OFFLINE_HTML_B64__) throw new Error('blank offline build is not bundled')
  const bytes = Uint8Array.from(atob(__OFFLINE_HTML_B64__), (c) => c.charCodeAt(0))
  const html = new TextDecoder().decode(bytes)
  return triggerDownload(html, OFFLINE_FILE_NAME)
}

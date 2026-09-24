import { EMBED_ID, parseSnapshot, type Snapshot } from './store'

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
export const downloadName = (d = new Date()): string =>
  `solar-dashboard-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.html`

/** Build the offline file and hand it to the browser as a download. Returns the file name. */
export function downloadHtml(snap: Snapshot): string {
  if (!pristine) throw new Error('capturePristine() was not called')
  const html = injectSnapshot(pristine, snap)
  if (!extractSnapshot(html)) throw new Error('embedded data failed to round-trip')
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = downloadName()
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return a.download
}

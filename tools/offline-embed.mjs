import { readFileSync } from 'node:fs'

const OFFLINE_FILE = 'solar-dashboard-offline.html'

/**
 * Demo build only: the blank offline build's HTML, base64-encoded, so the online app can hand it out as a
 * download (downloadBlankOffline). The file is the real build:offline artifact — it starts empty, no sample
 * and nothing a visitor imported (that lives only in the browser, never in this string). base64 keeps a
 * literal </script> out of the demo's inline bundle and hides the offline build's data: font URLs from the
 * privacy scan. Returns '' when the file is not on disk yet (dev, or build:demo run before build:offline)
 * → the sidebar button hides itself instead of handing out a broken file.
 *
 * Lives in a .mjs (like privacy-check.mjs) so vite.config.ts needs no @types/node for Buffer / node:fs.
 */
export function readOfflineHtmlB64(offline) {
  if (offline) return '' // the offline build IS the blank file; it needs no copy of itself
  try {
    return Buffer.from(readFileSync(`dist/${OFFLINE_FILE}`, 'utf8'), 'utf8').toString('base64')
  } catch {
    return ''
  }
}

/**
 * Privacy guardrail (T-008): fail the build if real homeowner data could reach the public repo or site.
 * Repo and Pages site are public. data/sample-*.csv may be TRACKED (synthetic fixtures), but NO build
 * bundles any data file: the online build starts empty and holds only what the visitor imports in their
 * own browser, behind the CSP network-lock. Reports file and marker names only — never data contents (CI logs are public).
 *
 * Two places run it: checkBundledModules inside each Vite build (vite.config.ts), and this CLI after both
 * builds (`npm run build` ends with it):
 *   node tools/privacy-check.mjs [--demo <html>] [--offline <html>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SAMPLE_CSV = /^data\/sample-[^/]+\.csv$/
const SPREADSHEET = /\.(xls|xlsx|xlsm|xlsb)$/i

/** (d) git must track no real data: only data/sample-*.csv, no spreadsheets, no saved dashboards. */
export function checkTracked(paths) {
  const problems = []
  for (const p of paths) {
    if (SPREADSHEET.test(p)) problems.push(`git tracks a spreadsheet: ${p}`)
    else if (p.startsWith('data/') && !SAMPLE_CSV.test(p)) problems.push(`git tracks a non-sample file in data/: ${p}`)
    else if (/\.csv$/i.test(p) && !SAMPLE_CSV.test(p)) problems.push(`git tracks a CSV that is not data/sample-*.csv: ${p}`)
    else if (/\.html?$/i.test(p) && p !== 'index.html') problems.push(`git tracks an HTML file (saved dashboards carry data): ${p}`)
  }
  return problems
}

const APP_CODE = /^src\/.+\.(ts|tsx|js|mjs|css)$/
// CSS Modules read files named in `composes … from` / `@value … from` on their own, out of the guard's sight;
// the app does not use them, so any is refused
const CSS_MODULE = /\.module\.[a-z]+$/i

/**
 * (a) What a build actually bundled: the module ids Vite resolved (called from the vite.config.ts plugin), so no
 * way of writing an import — glob, alias, URL, JSON — can slip past. Allowlist: app code in src/, packages,
 * index.html and bundler-virtual ids. NO build bundles data/ any more (the online build starts empty), so a
 * sample CSV — or any other data file — in the output is a leak risk and fails.
 * expectAppCode (default on): fail if no app module is seen — the guard would be blind to the real module list.
 * The CSS guard turns it off: a stylesheet set can legitimately be all packages (fonts).
 */
export function checkBundledModules(ids, { root, offline, expectAppCode = true }) {
  const base = `${root.replace(/\\/g, '/').replace(/\/$/, '')}/`.toLowerCase()
  const label = offline ? 'offline' : 'demo'
  const problems = []
  let appCode = 0
  for (const raw of ids) {
    if (raw.startsWith('\0')) continue // virtual helper modules from plugins
    const id = raw.replace(/\\/g, '/').split('?')[0]
    const rel = id.toLowerCase().startsWith(base) ? id.slice(base.length) : id
    if (CSS_MODULE.test(rel)) {
      problems.push(`${label} build uses a CSS Module (not allowed — it can pull in files unchecked): ${rel}`)
      continue
    }
    // packages of this repo only — a node_modules folder elsewhere could hold anything
    if (rel.startsWith('node_modules/') || rel === 'index.html' || APP_CODE.test(rel)) {
      if (APP_CODE.test(rel)) appCode++
      continue
    }
    problems.push(`${label} build bundles a file outside the allowlist: ${rel}`)
  }
  // no app module means Vite handed us no real module list — the guard would silently pass anything
  if (expectAppCode && appCode === 0) problems.push(`${label} build shows no app code — the bundled-module guard sees nothing (broken)`)
  return problems
}

/** The build must write exactly the two single-file HTMLs: any extra file (from index.html links, a public/ dir…) gets published too. */
export const DIST_FILES = ['index.html', 'solar-dashboard-offline.html']
export function checkDist(files) {
  return files.filter((f) => !DIST_FILES.includes(f)).map((f) => `dist/ holds an unexpected file (it would be published): ${f}`)
}

// Files the build inlined into the page (CSS url(), assets): only fonts and images are expected. Text, JSON,
// spreadsheets… end up as data:text/… or data:application/… — and real data could hide there.
const INLINED_FILE = /data:(application|text|audio|video|model|message|multipart)\/[\w.+-]+/gi
function inlinedFiles(html, label) {
  const types = [...new Set([...html.matchAll(INLINED_FILE)].map((m) => m[0].slice(5).toLowerCase()))]
  return types.map((t) => `${label} bundle inlines a file that is not a font or image: ${t}`)
}

/** A few data rows spread through a sample CSV — enough to tell whether its contents ended up in a bundle. */
export function sampleFingerprints(csvText) {
  const rows = csvText.split(/\r\n|\r|\n/).slice(1).filter((l) => l.trim())
  if (rows.length === 0) return []
  return [0.25, 0.5, 0.75].map((f) => rows[Math.floor(rows.length * f)])
}

/** prints: [{ file, lines }] — a sample with no rows cannot be detected, so it fails instead of passing silently. */
const foundIn = (html, lines) => lines.some((l) => html.includes(l))
const unprintable = (prints) => prints.filter((p) => p.lines.length === 0).map((p) => `${p.file} has no data rows to fingerprint`)

/**
 * (c) online/demo bundle: it now starts EMPTY (no sample showcase) and only ever holds data the visitor
 * imports in their own browser. So, like the offline build, it must carry NO sample data and MUST carry the
 * CSP network-lock — the lock is what keeps imported real data from ever leaving the page.
 */
export function checkDemo(html, prints) {
  const problems = [...unprintable(prints), ...inlinedFiles(html, 'demo')]
  for (const { file, lines } of prints) {
    if (foundIn(html, lines)) problems.push(`demo bundle contains sample data from ${file}`)
  }
  return [...problems, ...checkNetworkLock(html, 'demo')]
}

const LOCAL_SOURCES = new Set(["'none'", "'unsafe-inline'", 'data:', 'blob:'])
// exact name: a "…-Report-Only" policy only reports, it blocks nothing
const CSP_META = /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy(?=["'\s>])[^>]*>/i

/**
 * The CSP network-lock BOTH builds must carry: default-src/connect-src/form-action 'none', and no directive
 * may name a network source. This is what lets the online build hold imported real data — the lock closes
 * every egress channel, so data cannot leave the page even via a bug, a dependency, or injected script.
 */
export function checkNetworkLock(html, label) {
  const problems = []
  const policy = cspDirectives(html)
  // form-action is not covered by default-src, so a form could still post data out without it
  for (const name of ['default-src', 'connect-src', 'form-action']) {
    // 'none' only counts alone: browsers ignore it when any other source is listed
    if (policy.get(name) !== "'none'") problems.push(`${label} bundle is missing the network lock (CSP ${name} 'none')`)
  }
  // no directive may name anything on the network (img/script/font/report-uri… could carry data out)
  for (const [name, value] of policy) {
    for (const src of value.split(/\s+/).filter(Boolean)) {
      if (!LOCAL_SOURCES.has(src.toLowerCase())) problems.push(`${label} CSP ${name} allows a network source: ${src}`)
    }
  }
  return problems
}

/** (b) offline bundle: zero sample data, and the CSP network lock is present. */
export function checkOffline(html, prints) {
  const problems = [...unprintable(prints), ...inlinedFiles(html, 'offline')]
  for (const { file, lines } of prints) {
    if (foundIn(html, lines)) problems.push(`offline bundle contains sample data from ${file}`)
  }
  return [...problems, ...checkNetworkLock(html, 'offline')]
}

/** Directives of the first live CSP meta in <head> (browsers ignore it elsewhere; comments skipped; &#39; decoded). */
function cspDirectives(html) {
  const head = html.replace(/<!--[\s\S]*?-->/g, '').match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? ''
  const meta = head.match(CSP_META)?.[0] ?? ''
  const content = (meta.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? meta.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1] ?? '')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
  const out = new Map()
  for (const d of content.split(';')) {
    const [name, ...values] = d.trim().split(/\s+/)
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), values.join(' '))
  }
  return out
}

// ---------- CLI: run every check on the real tree ----------

function readBundle(root, path, label) {
  const full = join(root, path)
  if (!existsSync(full)) return { html: null, problems: [`${label} bundle not found: ${path} — run the build first`] }
  return { html: readFileSync(full, 'utf8'), problems: [] }
}

export function main(argv = process.argv.slice(2)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const arg = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
  }
  const demoPath = arg('--demo', 'dist/index.html')
  const offlinePath = arg('--offline', 'dist/solar-dashboard-offline.html')

  // -z: raw paths (no quoting of Thai names); honours GIT_INDEX_FILE
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const prints = readdirSync(join(root, 'data'))
    .filter((f) => SAMPLE_CSV.test(`data/${f}`))
    .map((f) => ({ file: `data/${f}`, lines: sampleFingerprints(readFileSync(join(root, 'data', f), 'utf8')) }))

  const dist = join(root, 'dist')
  const distFiles = existsSync(dist)
    ? readdirSync(dist, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dist, join(e.parentPath, e.name)).replace(/\\/g, '/'))
    : []

  const demo = readBundle(root, demoPath, 'demo')
  const offline = readBundle(root, offlinePath, 'offline')
  const results = [
    ['git tracks no real data', checkTracked(tracked)],
    [`demo bundle (${demoPath}) has no samples, network locked`, demo.html === null ? demo.problems : checkDemo(demo.html, prints)],
    [`offline bundle (${offlinePath}) has no samples, network locked`, offline.html === null ? offline.problems : checkOffline(offline.html, prints)],
    ['dist/ holds only the two HTML files', checkDist(distFiles)],
  ]
  if (prints.length === 0) results.push(['sample CSVs found', ['no data/sample-*.csv — nothing to fingerprint']])

  let failed = 0
  console.log('privacy-check')
  for (const [name, problems] of results) {
    console.log(`  ${problems.length ? 'FAIL' : 'PASS'}  ${name}`)
    for (const p of problems) console.log(`        - ${p}`)
    if (problems.length) failed++
  }
  if (failed) console.log(`privacy-check: ${failed} check(s) failed — real data could reach the public repo or site`)
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()

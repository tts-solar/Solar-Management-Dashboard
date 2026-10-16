import { describe, expect, it } from 'vitest'
import { checkBundledModules, checkDemo, checkDist, checkOffline, checkTracked, sampleFingerprints } from './privacy-check.mjs'

// Fake data only — never real CSVs.
const CSV = ['Date/Time,Energy Produced (Wh)', ...Array.from({ length: 8 }, (_, i) => `12/0${i + 1}/2025 12:00,${100 + i}`)].join('\r\n')
const prints = [{ file: 'data/sample-Z.csv', lines: sampleFingerprints(CSV) }]
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'">`
const demoHtml = `<html><head>${CSP}</head><script>var d=\`${CSV.replace(/\r/g, '')}\`</script></html>`
const offlineHtml = `<html><head>${CSP}</head><script>import CSV</script></html>`
// a clean single-file build: network-locked, carries no sample data (the new demo starts empty)
const cleanHtml = `<html><head>${CSP}</head><script>var app=1</script></html>`

describe('sampleFingerprints', () => {
  it('picks 3 data rows, no header, no CR', () => {
    const lines = sampleFingerprints(CSV)
    expect(lines).toHaveLength(3)
    for (const l of lines) {
      expect(l).not.toContain('\r')
      expect(l).not.toContain('Date/Time')
    }
  })
  it('handles CR-only line endings', () => {
    expect(sampleFingerprints(CSV.replace(/\r\n/g, '\r'))).toEqual(sampleFingerprints(CSV))
  })
  it('a header-only sample cannot pass silently', () => {
    const empty = [{ file: 'data/sample-Y.csv', lines: sampleFingerprints('Date/Time,Energy Produced (Wh)\r\n') }]
    expect(checkDemo(demoHtml, empty)).toEqual(['data/sample-Y.csv has no data rows to fingerprint'])
    expect(checkOffline(offlineHtml, empty)).toEqual(['data/sample-Y.csv has no data rows to fingerprint'])
  })
})

describe('checkTracked (git)', () => {
  it('passes samples, index.html and code', () => {
    expect(checkTracked(['index.html', 'data/sample-B.csv', 'src/main.ts', 'package.json'])).toEqual([])
  })
  it.each([
    ['data/MH_15 นาที ราย 6 เดือน.csv', 'non-sample file in data/'],
    ['data/Fw__folder/readme.txt', 'non-sample file in data/'],
    ['data/sub/sample-B.csv', 'non-sample file in data/'],
    ['report.xlsx', 'spreadsheet'],
    ['data/sample-B.xlsx', 'spreadsheet'],
    ['exports/real.csv', 'CSV that is not'],
    ['solar-dashboard-2026-01-01.html', 'HTML file'],
    ['dist/solar-dashboard-offline.html', 'HTML file'],
  ])('fails on %s', (path, why) => {
    const problems = checkTracked(['index.html', path])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(why)
    expect(problems[0]).toContain(path)
  })
})

describe('checkBundledModules (what the build actually bundled)', () => {
  // ids as Vite reports them on Windows and Linux
  const ROOT = 'D:/Solar Management Dashboard'
  const clean = [
    'D:/Solar Management Dashboard/index.html',
    'D:/Solar Management Dashboard/src/main.ts',
    'D:/Solar Management Dashboard/src/styles.css',
    'D:/Solar Management Dashboard/node_modules/chart.js/dist/chart.js',
    'D:/Solar Management Dashboard/node_modules/@fontsource/montserrat/files/x.woff2?url',
    '\0vite/preload-helper.js',
  ]
  const sample = 'D:/Solar Management Dashboard/data/sample-B.csv?raw'
  const packagesOnly = ['D:/Solar Management Dashboard/node_modules/@fontsource/montserrat/latin-400.css']

  it('passes app code and packages in both builds', () => {
    expect(checkBundledModules(clean, { root: ROOT, offline: false })).toEqual([])
    expect(checkBundledModules(clean, { root: ROOT, offline: true })).toEqual([])
  })
  it('matches the root regardless of drive-letter case and slashes', () => {
    expect(checkBundledModules(['d:\\Solar Management Dashboard\\src\\main.ts'], { root: 'D:\\Solar Management Dashboard\\', offline: true })).toEqual([])
  })
  it('fails when either build bundles a sample (no build ships data now)', () => {
    expect(checkBundledModules([...clean, sample], { root: ROOT, offline: false })).toEqual([
      'demo build bundles a file outside the allowlist: data/sample-B.csv',
    ])
    expect(checkBundledModules([...clean, sample], { root: ROOT, offline: true })).toEqual([
      'offline build bundles a file outside the allowlist: data/sample-B.csv',
    ])
  })
  it.each([
    'D:/Solar Management Dashboard/data/MH_15 นาที ราย 6 เดือน.csv?raw', // real CSV, however it was imported
    'D:/Solar Management Dashboard/data/MH_15 นาที ราย 6 เดือน.xlsx',
    'D:/Solar Management Dashboard/data/export.json',
    'D:/Solar Management Dashboard/src/data/real.csv?raw', // data dropped inside src/
    'D:/Solar Management Dashboard/design/notes.tsv',
    'D:/elsewhere/real.csv',
    'D:/elsewhere/node_modules/x/real.csv', // a node_modules folder outside this repo is not a package
  ])('fails on %s', (id) => {
    const problems = checkBundledModules([...clean, id], { root: ROOT, offline: false })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('demo build bundles a file outside the allowlist')
  })
  it.each(['src/x.module.css', 'node_modules/pkg/y.module.scss'])('refuses a CSS Module: %s', (rel) => {
    expect(checkBundledModules([...clean, `${ROOT}/${rel}`], { root: ROOT, offline: false })).toEqual([
      `demo build uses a CSS Module (not allowed — it can pull in files unchecked): ${rel}`,
    ])
  })
  it('expectAppCode:false skips the blind check (a stylesheet set can be all packages)', () => {
    expect(checkBundledModules(packagesOnly, { root: ROOT, offline: false, expectAppCode: false })).toEqual([])
  })
  it('fails when the build shows no app code (guard is blind)', () => {
    expect(checkBundledModules(packagesOnly, { root: ROOT, offline: false })).toEqual([
      'demo build shows no app code — the bundled-module guard sees nothing (broken)',
    ])
  })
})

describe('checkDist (what gets published)', () => {
  it('passes with just the two HTML files', () => {
    expect(checkDist(['index.html', 'solar-dashboard-offline.html'])).toEqual([])
  })
  it.each(['fake-1a2b3c.csv', 'assets/real.json', 'favicon.ico'])('fails on an extra file %s', (f) => {
    expect(checkDist(['index.html', 'solar-dashboard-offline.html', f])).toEqual([
      `dist/ holds an unexpected file (it would be published): ${f}`,
    ])
  })
})

describe('checkDemo (demo bundle)', () => {
  it('passes with the network lock and no samples', () => {
    expect(checkDemo(cleanHtml, prints)).toEqual([])
  })
  it('allows inlined fonts and images', () => {
    expect(checkDemo(cleanHtml + 'url(data:font/woff2;base64,AA) url(data:image/png;base64,AA) url(data:image/svg+xml,%3C)', prints)).toEqual([])
  })
  it.each([
    ['data:text/csv;base64,AA', 'text/csv'], // CSS url() to a CSV gets inlined like this
    ['data:application/octet-stream;base64,AA', 'application/octet-stream'],
    ['data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AA', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('fails on an inlined %s', (uri, type) => {
    const problems = [checkDemo(cleanHtml + `url(${uri})`, prints), checkOffline(offlineHtml + `url(${uri})`, prints)]
    expect(problems).toEqual([
      [`demo bundle inlines a file that is not a font or image: ${type}`],
      [`offline bundle inlines a file that is not a font or image: ${type}`],
    ])
  })
  it('does not mistake minified code for an inlined file', () => {
    expect(checkDemo(cleanHtml + '{data:t/e,label:n}', prints)).toEqual([])
  })
  it('allows import code — both builds ship it; the CSP lock is what keeps data in', () => {
    expect(checkDemo(cleanHtml + `<script>addEventListener('dragover',f)</script><button>ล้างข้อมูล</button>`, prints)).toEqual([])
    // the offline bundle is allowed to carry it too
    expect(checkOffline(offlineHtml + `<button>ล้างข้อมูล</button>`, prints)).toEqual([])
  })
  it('fails when the CSP network lock is missing (online holds imported data, so the lock is required)', () => {
    const problems = checkDemo(cleanHtml.replace(CSP, ''), prints)
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toContain("connect-src 'none'")
  })
  it('fails when a sample leaks into the demo bundle (it must start empty)', () => {
    expect(checkDemo(demoHtml, prints)).toEqual(['demo bundle contains sample data from data/sample-Z.csv'])
  })
})

describe('checkOffline (offline bundle)', () => {
  it('passes with CSP and no samples', () => {
    expect(checkOffline(offlineHtml, prints)).toEqual([])
  })
  it('reads the CSP the way Vite writes it (quotes as &#39;)', () => {
    expect(checkOffline(`<html><head>${CSP.replace(/'/g, '&#39;')}</head></html>`, prints)).toEqual([])
  })
  it('fails when a sample row is bundled', () => {
    const problems = checkOffline(offlineHtml + prints[0].lines[1], prints)
    expect(problems).toEqual(['offline bundle contains sample data from data/sample-Z.csv'])
  })
  it('fails when connect-src lists a source besides none (browser would allow it)', () => {
    const leaky = offlineHtml.replace("connect-src 'none'", "connect-src 'none' https://example.com")
    expect(checkOffline(leaky, prints)).toEqual([
      "offline bundle is missing the network lock (CSP connect-src 'none')",
      'offline CSP connect-src allows a network source: https://example.com',
    ])
  })
  it('fails when any other directive allows the network (e.g. images)', () => {
    const leaky = offlineHtml.replace("connect-src 'none'", "connect-src 'none'; img-src data: https:")
    expect(checkOffline(leaky, prints)).toEqual(['offline CSP img-src allows a network source: https:'])
  })
  it.each([
    ['inside an HTML comment', `<html><head><!-- ${CSP} --></head></html>`],
    ['outside <head> (browsers ignore it there)', `<html><head></head><body>${CSP}</body></html>`],
    ['report-only (reports, blocks nothing)', `<html><head>${CSP.replace('Security-Policy', 'Security-Policy-Report-Only')}</head></html>`],
  ])('does not count a CSP tag %s', (_, html) => {
    expect(checkOffline(html, prints)).toHaveLength(3)
  })
  it('fails without form-action (forms are not covered by default-src)', () => {
    expect(checkOffline(offlineHtml.replace("; form-action 'none'", ''), prints)).toEqual([
      "offline bundle is missing the network lock (CSP form-action 'none')",
    ])
  })
  it('fails without the CSP network lock', () => {
    const problems = checkOffline('<html><head></head></html>', prints)
    expect(problems).toHaveLength(3)
    expect(problems[1]).toContain("connect-src 'none'")
  })
})

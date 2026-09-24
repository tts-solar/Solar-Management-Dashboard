import { describe, expect, it } from 'vitest'
import { downloadName, extractSnapshot, injectSnapshot, snapshotTag } from './download'
import { parseSnapshot, upsertPlant, type Snapshot } from './store'
import type { Plant } from '../data/types'

const day = (date: string, produced = 10): Plant['daily'][number] => ({
  date,
  produced,
  consumed: 20,
  exported: 1,
  imported: 11,
  peakKw: 3.2,
  samples: 96,
})

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1,
  id: '2026-09-24T03:00:00.000Z',
  plants: [{ id: 'MH', name: 'MH', daily: [day('2026-01-01'), day('2026-01-02', 12.5)], source: 'MH_real.csv' }],
  settings: { MH: { name: 'Plant </script><b>x', tariff: 5.1, investment: 1_200_000 } },
  ...over,
})

// shaped like the single-file build: the bundle is inline and itself mentions </body>
const PAGE =
  '<!DOCTYPE html>\n<html lang="th"><head><script type="module">const s="</body>";</script></head>' +
  '<body><div id="app"></div></body></html>'

describe('offline download', () => {
  it('round-trips plants and settings through the HTML', () => {
    const s = snap()
    const html = injectSnapshot(PAGE, s)
    expect(extractSnapshot(html)).toEqual(s)
  })

  it('places the data before the real </body>, not inside the bundle', () => {
    const html = injectSnapshot(PAGE, snap())
    expect(html.startsWith(PAGE.slice(0, PAGE.lastIndexOf('</body>')))).toBe(true)
    expect(html.endsWith('</body></html>')).toBe(true)
    expect(html.indexOf('id="solar-data"')).toBeGreaterThan(html.indexOf('<div id="app">'))
  })

  it('never lets data text close the script tag', () => {
    const tag = snapshotTag(snap())
    const inner = tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('<'))
    expect(inner).not.toMatch(/<\/?script/i)
    expect(inner).not.toContain('<')
  })

  it('names the file solar-dashboard-<date>.html', () => {
    expect(downloadName(new Date(2026, 8, 4))).toBe('solar-dashboard-2026-09-04.html')
  })
})

describe('parseSnapshot', () => {
  it('rejects malformed or empty data so the app falls back to the sample', () => {
    expect(parseSnapshot('')).toBeNull()
    expect(parseSnapshot('{not json')).toBeNull()
    expect(parseSnapshot(JSON.stringify({ v: 2, plants: [] }))).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...snap(), plants: [] }))).toBeNull()
    const bad = snap()
    bad.plants[0].daily[0] = { ...bad.plants[0].daily[0], produced: 'x' as unknown as number }
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull()
  })

  it('sorts days and fills a missing name', () => {
    const s = snap()
    s.plants[0].daily.reverse()
    const raw = JSON.parse(JSON.stringify(s))
    delete raw.plants[0].name
    const out = parseSnapshot(JSON.stringify(raw))!
    expect(out.plants[0].name).toBe('MH')
    expect(out.plants[0].daily.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02'])
  })
})

describe('upsertPlant', () => {
  it('replaces a plant with the same id and adds new ones in id order', () => {
    const list: Plant[] = [{ id: 'MH', name: 'MH', daily: [day('2026-01-01')], source: 'sample-MH.csv' }]
    expect(upsertPlant(list, { id: 'MH', name: 'MH', daily: [day('2026-02-01')], source: 'MH.csv' })).toBe('replaced')
    expect(list).toHaveLength(1)
    expect(list[0].source).toBe('MH.csv')
    expect(upsertPlant(list, { id: 'KK', name: 'KK', daily: [], source: 'KK.csv' })).toBe('added')
    expect(list.map((p) => p.id)).toEqual(['KK', 'MH'])
  })
})

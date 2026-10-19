import { describe, expect, it } from 'vitest'
import { buildReportHtml, reportRows } from './exportReport'
import { withDefaults, type PlantSettings } from '../data/settings'
import type { DailyRow, Plant } from '../data/types'

const day = (date: string, produced: number, imported = 0): DailyRow => ({
  date,
  produced,
  consumed: produced,
  exported: 0,
  imported,
  peakKw: produced / 5,
  samples: 96,
})

// H1 (Mar) at tariff 5, H2 (Aug) at tariffH2 7 — exercises the half-year split.
const plant: Plant = {
  id: 'A',
  name: 'Alpha',
  daily: [day('2024-03-15', 100), day('2024-08-20', 200)],
  source: 'test',
}
const s: PlantSettings = withDefaults({ kWp: 10, tariff: 5, tariffH2: 7 })

describe('reportRows', () => {
  it('sums produced and tariff-weighted saving per year (H1/H2 aware)', () => {
    const [row] = reportRows(plant, s, 'year')
    expect(row.key).toBe('2024')
    expect(row.produced).toBe(300)
    expect(row.saving).toBe(100 * 5 + 200 * 7) // 1900
    expect(row.effTariff).toBeCloseTo(1900 / 300, 6)
    expect(row.days).toBe(2)
  })

  it('splits a year into H1 / H2 buckets with their own tariff', () => {
    const rows = reportRows(plant, s, 'half')
    expect(rows.map((r) => r.key)).toEqual(['2024-H1', '2024-H2'])
    expect(rows[0]).toMatchObject({ produced: 100, saving: 500 })
    expect(rows[1]).toMatchObject({ produced: 200, saving: 1400 })
  })

  it('buckets by month', () => {
    const rows = reportRows(plant, s, 'month')
    expect(rows.map((r) => r.key)).toEqual(['2024-03', '2024-08'])
    expect(rows[0].saving).toBe(500)
    expect(rows[1].saving).toBe(1400)
  })

  it('reports efficiency as null when capacity cannot be estimated', () => {
    // peakKw 0 everywhere + kWp auto → estimated kWp 0 → simulate 0 → no efficiency to show
    const flat: Plant = {
      id: 'Z',
      name: 'Z',
      daily: [{ date: '2024-03-01', produced: 50, consumed: 0, exported: 0, imported: 0, peakKw: 0, samples: 96 }],
      source: 'test',
    }
    const auto = withDefaults({ tariff: 5 }) // kWp left null → auto-estimated
    const [row] = reportRows(flat, auto, 'year')
    expect(row.efficiency).toBeNull()
  })
})

describe('buildReportHtml', () => {
  it('renders a page per plant with a table and an SVG saving chart', () => {
    const html = buildReportHtml([plant], { A: { kWp: 10, tariff: 5, tariffH2: 7 } }, (p) => p.name, 'year')
    expect(html).toContain('Alpha')
    expect(html).toContain('<table')
    expect(html).toContain('<svg')
    expect(html).toContain('รวม') // totals row
  })
})

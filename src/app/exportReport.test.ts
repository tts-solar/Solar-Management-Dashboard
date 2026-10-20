import { describe, expect, it } from 'vitest'
import { buildReportHtml, reportRows, yearsOf } from './exportReport'
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

  it('limits rows to a single calendar year when year is given', () => {
    const multi: Plant = {
      id: 'M',
      name: 'M',
      daily: [day('2024-05-10', 100), day('2025-05-10', 200), day('2026-05-10', 300)],
      source: 'test',
    }
    const ss = withDefaults({ kWp: 10, tariff: 5 })
    const rows = reportRows(multi, ss, 'year', '2025')
    expect(rows.map((r) => r.key)).toEqual(['2025'])
    expect(rows[0].produced).toBe(200)
  })
})

describe('yearsOf', () => {
  it('lists every distinct year across plants, newest first', () => {
    const a: Plant = { id: 'a', name: 'a', daily: [day('2024-01-01', 1), day('2026-01-01', 1)], source: 'test' }
    const b: Plant = { id: 'b', name: 'b', daily: [day('2025-01-01', 1)], source: 'test' }
    expect(yearsOf([a, b])).toEqual(['2026', '2025', '2024'])
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

  it('shows a no-data notice (not the KPI table) for a year with no rows', () => {
    // plant has 2024 data only; filtering to 2025 must not render the misleading investment card (M6b)
    const html = buildReportHtml([plant], { A: { kWp: 10, tariff: 5, investment: 500000 } }, (p) => p.name, 'month', '2025')
    expect(html).toContain('ไม่มีข้อมูลสำหรับปี 2025')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('เงินลงทุน')
  })
})

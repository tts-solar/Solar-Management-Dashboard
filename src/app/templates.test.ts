import { describe, expect, it } from 'vitest'
import { csvToGrid, parseCsv } from '../data/csv'
import { isMonthlyReportGrid, parsePlantReport } from '../data/report'
import { dailyTemplateCsv, monthlyTemplateCsv } from './templates'

// The downloadable templates must stay importable by the dashboard's own parsers, and must land on
// the right path (monthly report vs interval export). These tests fail loudly if a template drifts
// out of the format the importer recognizes.

describe('downloadable import templates', () => {
  it('monthly template is detected as a monthly report and parses to the filled-in months', () => {
    const grid = csvToGrid(monthlyTemplateCsv())
    expect(isMonthlyReportGrid(grid)).toBe(true)

    const r = parsePlantReport(grid, 'Plant Report - ตัวอย่าง 2026.csv')
    expect(r.id).toBe('ตัวอย่าง') // plant identity comes from the file name
    expect(r.months).toBe(3)
    expect(r.skipped).toBe(0)
    expect(r.daily.map((d) => d.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(r.daily[0]).toMatchObject({ produced: 1250.5, consumed: 320, exported: 980.2, imported: 50.1, peakKw: 8.4 })
  })

  it('daily template is NOT a monthly report and folds into day rows via the interval parser', () => {
    const grid = csvToGrid(dailyTemplateCsv())
    expect(isMonthlyReportGrid(grid)).toBe(false) // datetime cells, no bare YYYY-MM

    const parsed = parseCsv(dailyTemplateCsv())
    expect(parsed.daily).toHaveLength(1) // all readings are on the one sample day
    expect(parsed.daily[0].date).toBe('2026-01-01')
    expect(parsed.daily[0].produced).toBeGreaterThan(0)
    expect(parsed.skipped).toBe(0)
  })
})

describe('isMonthlyReportGrid routing', () => {
  it('rejects an interval export whose date column carries a full datetime', () => {
    const interval = csvToGrid(
      'Date/Time,Energy Produced (Wh)\n01/02/2026 00:15,1200\n01/02/2026 00:30,1500\n',
    )
    expect(isMonthlyReportGrid(interval)).toBe(false)
  })

  it('accepts a bare monthly report even without a title row above the header', () => {
    const monthly = csvToGrid('Statistical Period,PV Yield (kWh)\n2026-05,900\n2026-06,950\n')
    expect(isMonthlyReportGrid(monthly)).toBe(true)
  })
})

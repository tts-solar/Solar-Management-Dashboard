import { describe, expect, it } from 'vitest'
import { inRange, RANGE_DAILY_MAX, rangeDays, rangeIsDaily, sumRows, toMonthly } from './aggregate'
import type { DailyRow } from './types'

const day = (date: string, produced = 10): DailyRow => ({
  date, produced, consumed: 8, exported: 0, imported: 0, peakKw: produced / 5, samples: 96,
})

// three months of daily rows, one per day, Jan–Mar 2026
const daily: DailyRow[] = []
for (const [month, len] of [['01', 31], ['02', 28], ['03', 31]] as const) {
  for (let d = 1; d <= len; d++) daily.push(day(`2026-${month}-${String(d).padStart(2, '0')}`))
}

describe('inRange', () => {
  it('keeps rows on and between the bounds (inclusive both ends)', () => {
    const got = inRange(daily, '2026-01-10', '2026-02-05')
    expect(got[0].date).toBe('2026-01-10')
    expect(got[got.length - 1].date).toBe('2026-02-05')
    // 22 days left in Jan (10th–31st) + 5 in Feb
    expect(got).toHaveLength(22 + 5)
  })

  it('returns an empty list when the range misses every row', () => {
    expect(inRange(daily, '2025-01-01', '2025-12-31')).toHaveLength(0)
  })

  it('treats a single-day range as that one day', () => {
    const got = inRange(daily, '2026-02-14', '2026-02-14')
    expect(got.map((d) => d.date)).toEqual(['2026-02-14'])
  })

  it('compares as plain YYYY-MM-DD strings (no Date parsing, no timezone drift)', () => {
    // a bound that is not itself a data row still clips correctly
    const got = inRange(daily, '2026-03-30', '2026-04-15')
    expect(got.map((d) => d.date)).toEqual(['2026-03-30', '2026-03-31'])
  })
})

describe('rangeDays', () => {
  it('counts both endpoints', () => {
    expect(rangeDays('2026-01-01', '2026-01-01')).toBe(1)
    expect(rangeDays('2026-01-01', '2026-01-31')).toBe(31)
    expect(rangeDays('2026-01-01', '2026-03-31')).toBe(90) // 31 + 28 + 31
  })
})

describe('rangeIsDaily', () => {
  it('groups by day up to the daily ceiling, by month beyond it', () => {
    expect(rangeIsDaily('2026-01-01', '2026-01-31')).toBe(true) // 31 days
    // exactly RANGE_DAILY_MAX days is still daily; one more flips to monthly
    expect(rangeDays('2026-01-01', '2026-03-03')).toBe(RANGE_DAILY_MAX) // 31+28+3 = 62
    expect(rangeIsDaily('2026-01-01', '2026-03-03')).toBe(true)
    expect(rangeIsDaily('2026-01-01', '2026-03-04')).toBe(false) // 63 days → monthly
  })
})

describe('range grouping feeds the existing aggregators', () => {
  it('a short range sums to the same totals whether read day-by-day or in one lump', () => {
    const slice = inRange(daily, '2026-01-01', '2026-01-20')
    const lump = sumRows(slice)
    const byDay = slice.reduce((s, d) => s + d.produced, 0)
    expect(lump.produced).toBe(byDay)
    expect(lump.days).toBe(20)
  })

  it('a long range rolls up into one row per month touched', () => {
    const slice = inRange(daily, '2026-01-01', '2026-03-31')
    const months = toMonthly(slice)
    expect(months.map((m) => m.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(months[1].days).toBe(28) // all of Feb
  })
})

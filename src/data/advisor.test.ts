import { describe, expect, it } from 'vitest'
import { advise, headline, whatIf, DOD, ROUND_TRIP } from './advisor'
import { resolve } from './metrics'
import { DAYS_PER_YEAR } from './aggregate'
import { withDefaults, type PlantSettings } from './settings'
import type { DailyRow, DayProfile, Plant, ProfileSlot } from './types'

/** One day of an interval import: a real calendar date, `i` days into Jan 2026. */
const day = (produced: number, consumed: number, exported: number, imported: number, i = 0): DailyRow => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  produced,
  consumed,
  exported,
  imported,
  peakKw: produced / 5,
  samples: 96,
})
/** Ten days with the same balance — DISTINCT dates, because the advisor averages per calendar day. */
const tenDays = (produced: number, consumed: number, exported: number, imported: number): DailyRow[] =>
  Array.from({ length: 10 }, (_, i) => day(produced, consumed, exported, imported, i))
/** One row of a monthly Plant Report: a whole month, dated the 1st (see report.ts). */
const month = (ym: string, produced: number, consumed: number, exported: number, imported: number): DailyRow => ({
  date: `${ym}-01`,
  produced,
  consumed,
  exported,
  imported,
  peakKw: produced / 100,
  samples: 30,
})
/** A full year of monthly rows, every month the same. */
const year = (y: number, produced: number, consumed: number, exported: number, imported: number): DailyRow[] =>
  Array.from({ length: 12 }, (_, i) => month(`${y}-${String(i + 1).padStart(2, '0')}`, produced, consumed, exported, imported))
// only exported/imported drive sizing; produced/consumed are filled but unused by the simulation
const slot = (minute: number, exported: number, imported: number): ProfileSlot => ({
  minute,
  produced: exported,
  consumed: imported,
  exported,
  imported,
})
const plantOf = (daily: DailyRow[]): Plant => ({ id: 'MH', name: 'MH', daily, source: 'x.csv' })
// sunHours 4.5 × PR 0.8 = 3.6 kWh/day per added kW; tariff 4.5
const r = (daily: DailyRow[]) => resolve(plantOf(daily), withDefaults({ kWp: 25 }))

describe('advise', () => {
  it('recommends storage when there is both daytime surplus and grid import', () => {
    const daily = tenDays(100, 100, 30, 30)
    const a = advise(daily, r(daily))
    expect(a.verdict).toBe('storage')
    expect(a.size).toBe(Math.round(30 / DOD)) // min(export, import) / depth-of-discharge
  })

  it('recommends more solar when the plant still buys power with little surplus', () => {
    const daily = tenDays(50, 100, 1, 51)
    const a = advise(daily, r(daily))
    expect(a.verdict).toBe('solar')
    expect(a.size).toBe(Math.round(51 / 3.6))
  })

  it('says enough when production and use are balanced', () => {
    const daily = tenDays(100, 100, 2, 2)
    expect(advise(daily, r(daily)).verdict).toBe('enough')
  })

  it('says enough when there is big surplus but barely any import', () => {
    const daily = tenDays(200, 100, 100, 1)
    expect(advise(daily, r(daily)).verdict).toBe('enough')
  })
})

describe('advise with a 15-min profile', () => {
  // same daily totals (export 30, import 30) as the no-profile storage case, but with timing
  const daily = tenDays(100, 100, 30, 30)

  it('sizes the same as the daily estimate when all surplus precedes the demand', () => {
    const profile: DayProfile = [slot(720, 30, 0), slot(1080, 0, 30)] // midday surplus → evening import
    const a = advise(daily, r(daily), profile)
    expect(a.sizedFromProfile).toBe(true)
    expect(a.shiftableKwh).toBeCloseTo(30)
    expect(a.size).toBe(Math.round(30 / DOD)) // nothing lost to timing → matches the no-profile size
    expect(a.powerKw).toBeGreaterThan(0)
  })

  it('sizes smaller when some demand falls before the surplus (cannot be time-shifted)', () => {
    const profile: DayProfile = [slot(360, 0, 10), slot(720, 30, 0), slot(1080, 0, 20)]
    const a = advise(daily, r(daily), profile)
    expect(a.sizedFromProfile).toBe(true)
    expect(a.shiftableKwh).toBeCloseTo(20) // the 10 kWh morning import cannot be covered
    expect(a.size).toBe(Math.round(20 / DOD))
  })

  it('whatIf caps battery output at what timing allows', () => {
    const profile: DayProfile = [slot(360, 0, 10), slot(720, 30, 0), slot(1080, 0, 20)]
    const res = r(daily)
    const a = advise(daily, res, profile)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    // usable 36 → charge 30 → would deliver 27, but timing caps it at 20 kWh/day
    expect(w.importAvoided).toBeCloseTo(20)
    // and only the 20 it delivers (plus the round-trip loss) leaves the surplus — the rest stays sold
    expect(w.newExport).toBeCloseTo(30 - 20 / ROUND_TRIP)
  })
})

describe('whatIf', () => {
  it('a battery cuts grid import and yields a finite payback', () => {
    const daily = tenDays(100, 100, 30, 30)
    const res = r(daily)
    const a = advise(daily, res)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    // usable 36 → charge 30 → delivered min(27, 30) = 27 kWh/day avoided
    expect(w.importAvoided).toBeCloseTo(27)
    expect(w.annualSaving).toBeCloseTo(27 * 4.5 * 365)
    expect(w.addOnCost).toBe(600000)
    expect(w.paybackYears).toBeGreaterThan(0)
  })

  it('leaves surplus exported when the battery has no import to displace', () => {
    // produces 100, uses 60, sells 40, buys nothing — a battery here saves nothing at all
    const daily = tenDays(100, 60, 40, 0)
    const res = r(daily)
    const a = advise(daily, res)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.importAvoided).toBe(0)
    expect(w.annualSaving).toBe(0)
    expect(w.newExport).toBeCloseTo(40) // not swallowed by a battery that never discharges
    expect(w.newSelfConsumption).toBeCloseTo(a.selfConsumption!) // so self-consumption cannot inflate
  })

  it('reports the new self-SUFFICIENCY apart from the new self-consumption', () => {
    // asymmetric on purpose: 35% of its own output used on site, 70% of its demand self-met
    const daily = tenDays(200, 100, 130, 30)
    const res = r(daily)
    const a = advise(daily, res)
    expect(a.selfConsumption).toBeCloseTo(0.35)
    expect(a.selfSufficiency).toBeCloseTo(0.7)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.importAvoided).toBeCloseTo(30) // the battery covers the whole 30 kWh of import
    expect(w.newSelfSufficiency).toBeCloseTo(1) // every kWh used now comes from the plant
    expect(w.newSelfConsumption).toBeCloseTo((200 - (130 - 30 / ROUND_TRIP)) / 200) // ≈ 0.52, still far from 1
  })

  it('no add-on means no cost and no payback', () => {
    const daily = tenDays(100, 100, 30, 30)
    const res = r(daily)
    const w = whatIf(advise(daily, res), res, { addSolarKw: 0, addStorageKwh: 0, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.addOnCost).toBe(0)
    expect(w.paybackYears).toBeNull()
  })
})

/**
 * A monthly Plant Report carries ONE row per month. Every formula in advisor.ts is per calendar day,
 * so the averages must divide by the days the rows cover — not by the row count, which would read a
 * month's total as a day's and blow the recommendation up by ~30×.
 */
describe('monthly reports (one row per month)', () => {
  it('averages over the days the months cover, not the row count', () => {
    // 2025 has 365 days; 12 × 3650 kWh produced = 43,800 → 120 kWh per real day
    const daily = year(2025, 3650, 7300, 0, 3650)
    const a = advise(daily, r(daily))
    expect(a.monthly).toBe(true)
    expect(a.rows).toBe(12)
    expect(a.days).toBe(365)
    expect(a.avgProduced).toBeCloseTo(120)
    expect(a.avgConsumed).toBeCloseTo(240)
    expect(a.avgImported).toBeCloseTo(120)
    expect(a.verdict).toBe('solar')
    expect(a.size).toBe(Math.round(120 / 3.6)) // 33 kW, from the per-DAY import
  })

  it('counts a leap year and keeps a big commercial plant at a plant-sized scale', () => {
    // a year of monthly rows for a plant that buys nearly all of its power (round made-up figures)
    const perMonth = { produced: 10_000, consumed: 150_000, imported: 140_000 }
    const daily = year(2024, perMonth.produced, perMonth.consumed, 0, perMonth.imported)
    const res = resolve(plantOf(daily), withDefaults({ kWp: 1000, sunHours: 5, performanceRatio: 0.8, tariff: 4.5 }))
    const perKw = 5 * 0.8 // kWh/day per added kW
    const importPerDay = (perMonth.imported * 12) / 366 // 2024 is a leap year
    const a = advise(daily, res)
    expect(a.days).toBe(366)
    expect(a.avgImported).toBeCloseTo(importPerDay)
    expect(a.size).toBe(Math.round(importPerDay / perKw))
    // the old row-count basis sized this on a MONTH's import read as a day's — ~30× bigger
    expect(a.size).toBeLessThan(Math.round(perMonth.imported / perKw) / 10)
    const w = whatIf(a, res, { addSolarKw: a.size, addStorageKwh: 0, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.addOnCost).toBe(a.size * 25000)
    expect(w.annualSaving).toBeCloseTo(Math.min(a.size * perKw, importPerDay) * 4.5 * 365)
  })

  it('a daily import is unaffected: one row is one day', () => {
    const daily = tenDays(100, 100, 30, 30)
    const a = advise(daily, r(daily))
    expect(a.monthly).toBe(false)
    expect(a.days).toBe(10)
    expect(a.rows).toBe(10)
    expect(a.avgProduced).toBeCloseTo(100)
  })

  it('no data at all reports zero days rather than dividing by zero', () => {
    const a = advise([], r([]))
    expect(a.days).toBe(0)
    expect(a.rows).toBe(0)
    expect(a.monthly).toBe(false)
    expect(a.avgConsumed).toBe(0)
    expect(Number.isFinite(a.size)).toBe(true)
  })

  it('says it has no data instead of calling an empty plant balanced', () => {
    const a = advise([], r([]))
    expect(a.verdict).toBe('nodata') // NOT 'enough': all-zero averages are not a balanced plant
    expect(a.size).toBe(0)
    expect(headline(a)).toBe('ยังไม่มีข้อมูลพอจะแนะนำ')
    expect(a.reason).toContain('ยังไม่มีข้อมูล')
  })
})

describe('headline', () => {
  it('states a kW figure for solar, from daily or monthly data alike', () => {
    const d = tenDays(50, 100, 1, 51)
    expect(headline(advise(d, r(d)))).toBe(`แนะนำ: เพิ่ม Solar ~${advise(d, r(d)).size} kW`)
    // monthly totals answer "how much ENERGY per year", which is all solar sizing needs
    const m = year(2025, 1000, 10_000, 20, 9000) // barely any surplus → solar, not storage
    const a = advise(m, r(m))
    expect(a.monthly).toBe(true)
    expect(a.verdict).toBe('solar')
    expect(headline(a)).toBe(`แนะนำ: เพิ่ม Solar ~${a.size} kW`)
  })

  it('states a kWh figure for storage when the data has real days', () => {
    const d = tenDays(100, 100, 30, 30)
    const a = advise(d, r(d))
    expect(a.verdict).toBe('storage')
    expect(a.monthly).toBe(false)
    expect(headline(a)).toBe(`แนะนำ: เพิ่ม Energy Storage ~${a.size} kWh`)
  })

  it('withholds the storage size for monthly data, which cannot answer a timing question', () => {
    const m = year(2025, 6000, 6000, 1800, 1800)
    const a = advise(m, r(m))
    expect(a.verdict).toBe('storage')
    expect(a.monthly).toBe(true)
    expect(headline(a)).toBe('แนะนำ: พิจารณา Energy Storage — ข้อมูลรายเดือนยังระบุขนาดไม่ได้')
    expect(headline(a)).not.toContain('kWh')
    expect(a.size).toBeGreaterThan(0) // still there to prefill the what-if lever
  })

  it('says enough when nothing is worth adding', () => {
    const d = tenDays(100, 100, 2, 2)
    expect(headline(advise(d, r(d)))).toBe('เพียงพอแล้ว')
  })
})

describe('what-if pricing', () => {
  it('prices the yearly saving with the tariff of the year the data ends in', () => {
    const daily = tenDays(100, 100, 30, 30)
    const plant = plantOf(daily) // rows are in 2026
    const res = resolve(
      plant,
      withDefaults({
        kWp: 25,
        startDate: '2024-01-01',
        tariff: 4,
        tariffYearly: [
          { h1: 7, h2: 9 }, // 2024
          { h1: 6, h2: null }, // 2025
          { h1: 10, h2: 12 }, // 2026 — the year these rows are in → mean 11
        ],
      } as Partial<PlantSettings>),
    )
    const a = advise(daily, res)
    expect(a.year).toBe(2026)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.annualSaving).toBeCloseTo(w.importAvoided * 11 * DAYS_PER_YEAR)
  })

  it('still uses the base tariff when no per-year price is set', () => {
    const daily = tenDays(100, 100, 30, 30)
    const res = r(daily) // tariff 4.5, no tariffYearly
    const w = whatIf(advise(daily, res), res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.annualSaving).toBeCloseTo(27 * 4.5 * DAYS_PER_YEAR)
  })
})

describe('battery power from the profile', () => {
  it('scales the import peak on the import basis, not the export one', () => {
    // thin exports in two slots, one fat import slot later; the period imports twice what the
    // profile day does, so the import side must be scaled up ×2 and it is the binding peak
    const daily = tenDays(100, 100, 20, 40)
    const profile: DayProfile = [slot(600, 10, 0), slot(660, 10, 0), slot(1080, 0, 20)]
    const a = advise(daily, r(daily), profile)
    // peakImport 20 × (40/20) = 40 kWh in a 60-min slot → 40 kW; scaling it by the EXPORT ratio
    // (40/20 ÷ 2 = 1) would have reported half that
    expect(a.powerKw).toBeCloseTo(40)
  })

  it('reads the logging interval as the smallest step, not the first gap', () => {
    // the day starts with a skipped slot: 0 → 45 is three missing readings, not a 45-min interval
    const daily = tenDays(100, 100, 60, 10)
    const profile: DayProfile = [slot(0, 0, 10), slot(45, 30, 0), slot(60, 30, 0)]
    const a = advise(daily, r(daily), profile)
    expect(a.powerKw).toBeCloseTo((30 * 60) / 15) // 15-min interval → 120 kW, not 40
  })
})

describe('number formatting in the verdict line', () => {
  it('groups thousands the way the KPI cards do', () => {
    const daily = tenDays(100, 50_000, 1, 40_000)
    const a = advise(daily, r(daily))
    expect(a.verdict).toBe('solar')
    expect(headline(a)).toBe('แนะนำ: เพิ่ม Solar ~11,111 kW')
    expect(a.reason).toContain('40,000 kWh/วัน')
  })
})

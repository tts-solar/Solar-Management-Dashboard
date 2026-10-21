import { describe, expect, it } from 'vitest'
import { advise, whatIf, DOD } from './advisor'
import { resolve } from './metrics'
import { withDefaults } from './settings'
import type { DailyRow, DayProfile, Plant, ProfileSlot } from './types'

const day = (produced: number, consumed: number, exported: number, imported: number): DailyRow => ({
  date: '2026-01-01',
  produced,
  consumed,
  exported,
  imported,
  peakKw: produced / 5,
  samples: 96,
})
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
    const daily = Array(10).fill(day(100, 100, 30, 30))
    const a = advise(daily, r(daily))
    expect(a.verdict).toBe('storage')
    expect(a.size).toBe(Math.round(30 / DOD)) // min(export, import) / depth-of-discharge
  })

  it('recommends more solar when the plant still buys power with little surplus', () => {
    const daily = Array(10).fill(day(50, 100, 1, 51))
    const a = advise(daily, r(daily))
    expect(a.verdict).toBe('solar')
    expect(a.size).toBe(Math.round(51 / 3.6))
  })

  it('says enough when production and use are balanced', () => {
    const daily = Array(10).fill(day(100, 100, 2, 2))
    expect(advise(daily, r(daily)).verdict).toBe('enough')
  })

  it('says enough when there is big surplus but barely any import', () => {
    const daily = Array(10).fill(day(200, 100, 100, 1))
    expect(advise(daily, r(daily)).verdict).toBe('enough')
  })
})

describe('advise with a 15-min profile', () => {
  // same daily totals (export 30, import 30) as the no-profile storage case, but with timing
  const daily = Array(10).fill(day(100, 100, 30, 30))

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
  })
})

describe('whatIf', () => {
  it('a battery cuts grid import and yields a finite payback', () => {
    const daily = Array(10).fill(day(100, 100, 30, 30))
    const res = r(daily)
    const a = advise(daily, res)
    const w = whatIf(a, res, { addSolarKw: 0, addStorageKwh: 40, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    // usable 36 → charge 30 → delivered min(27, 30) = 27 kWh/day avoided
    expect(w.importAvoided).toBeCloseTo(27)
    expect(w.annualSaving).toBeCloseTo(27 * 4.5 * 365)
    expect(w.addOnCost).toBe(600000)
    expect(w.paybackYears).toBeGreaterThan(0)
  })

  it('no add-on means no cost and no payback', () => {
    const daily = Array(10).fill(day(100, 100, 30, 30))
    const res = r(daily)
    const w = whatIf(advise(daily, res), res, { addSolarKw: 0, addStorageKwh: 0, solarCostPerKw: 25000, storageCostPerKwh: 15000 })
    expect(w.addOnCost).toBe(0)
    expect(w.paybackYears).toBeNull()
  })
})

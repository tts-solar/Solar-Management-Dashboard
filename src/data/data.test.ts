import { describe, expect, it } from 'vitest'
import { CsvError, parseCsv, parseStamp, plantIdFromFile } from './csv'
import { dateFromNumber, dayNumber, sumRows, toMonthly, toYearly } from './aggregate'
import { bep, formatYM, resolve, withMetrics } from './metrics'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, withDefaults, type PlantSettings } from './settings'
import type { DailyRow, Plant } from './types'

// node:fs is loaded dynamically so the browser tsconfig needs no @types/node
const fsName: string = 'node:fs'
const fs = await import(/* @vite-ignore */ fsName)
const dataDir = new URL('../../data/', import.meta.url)
const csvFiles: string[] = (fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []).filter((f: string) =>
  f.toLowerCase().endsWith('.csv'),
)
const realFile = csvFiles.find((f) => !f.toLowerCase().startsWith('sample'))
const read = (f: string): string => fs.readFileSync(new URL(f, dataDir), 'utf8')

const HEADER = 'Date/Time,Energy Produced (Wh),Energy Consumed (Wh),Exported to Grid (Wh),Imported from Grid (Wh)'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n')
const day = (date: string, produced: number, consumed = 10): DailyRow => ({
  date, produced, consumed, exported: 0, imported: 0, peakKw: produced / 5, samples: 96,
})
const plantOf = (daily: DailyRow[]): Plant => ({ id: 'T', name: 'T', daily, source: 'test' })

describe('parseStamp', () => {
  it('reads US month-first dates', () => {
    expect(parseStamp('12/01/2025 00:00')).toEqual({ date: '2025-12-01', minute: 0 })
    expect(parseStamp('05/31/2026 23:45')).toEqual({ date: '2026-05-31', minute: 1425 })
  })
  it('accepts ISO and rejects impossible dates', () => {
    expect(parseStamp('2026-02-03 06:15')?.date).toBe('2026-02-03')
    expect(parseStamp('13/01/2025 00:00')).toBeNull()
    expect(parseStamp('02/30/2026 00:00')).toBeNull()
    expect(parseStamp('hello')).toBeNull()
  })
})

describe('parseCsv', () => {
  const r = parseCsv(
    csv(
      '12/01/2025 06:00,-5,1000,0,1000',
      '12/01/2025 06:15,2000,1500,500,0',
      '12/01/2025 06:30,3000,1000,2000,0',
      '12/02/2025 12:00,1000,4000,0,3000',
      '',
    ),
  )
  it('converts Wh to kWh and clamps negatives', () => {
    expect(r.rows).toBe(4)
    expect(r.clamped).toBe(1)
    expect(r.minProduced).toBe(0)
    expect(r.daily).toHaveLength(2)
    expect(r.daily[0]).toMatchObject({ date: '2025-12-01', produced: 5, consumed: 3.5, exported: 2.5, imported: 1, samples: 3 })
  })
  it('derives peak kW from the logging interval', () => {
    expect(r.intervalMin).toBe(15)
    expect(r.daily[0].peakKw).toBeCloseTo(12) // 3 kWh in 15 min
  })
  it('reports first/last stamps', () => {
    expect(r.first).toBe('2025-12-01 06:00')
    expect(r.last).toBe('2025-12-02 12:00')
  })
  it('rejects files without the needed columns', () => {
    expect(() => parseCsv('a,b\n1,2')).toThrow(CsvError)
    expect(() => parseCsv(HEADER)).toThrow(CsvError)
  })
  it('honours kWh headers, BOM and quotes', () => {
    const k = parseCsv('﻿"Date/Time","Energy Produced (kWh)"\n"12/01/2025 10:00","1.5"')
    expect(k.daily[0].produced).toBe(1.5)
  })
  it('names plants from file names', () => {
    expect(plantIdFromFile('MH_15 นาที ราย 6 เดือน.csv')).toBe('MH')
    expect(plantIdFromFile('sample-MH.csv')).toBe('MH')
    expect(plantIdFromFile('Plant B.csv')).toBe('Plant B')
  })
})

describe('aggregate', () => {
  const daily = [day('2025-12-30', 1), day('2025-12-31', 2), day('2026-01-01', 3)]
  it('groups by month and year', () => {
    expect(toMonthly(daily).map((m) => [m.key, m.produced, m.days])).toEqual([['2025-12', 3, 2], ['2026-01', 3, 1]])
    expect(toYearly(daily).map((y) => y.key)).toEqual(['2025', '2026'])
    expect(sumRows(daily).produced).toBe(6)
    expect(sumRows([]).days).toBe(0)
  })
  it('round-trips day numbers', () => {
    expect(dateFromNumber(dayNumber('2024-02-29'))).toBe('2024-02-29')
    expect(dayNumber('2026-01-01') - dayNumber('2025-12-31')).toBe(1)
  })
})

describe('metrics', () => {
  const plant = plantOf([day('2026-01-01', 100), day('2026-01-02', 50)]) // peak 20 kW → kWp 25 → 90 kWh/day
  const r = resolve(plant, DEFAULT_SETTINGS)
  it('auto-estimates kWp from peak output', () => {
    expect(r.kWp).toBe(25)
    expect(r.kWpAuto).toBe(true)
    expect(r.simulatePerDay).toBeCloseTo(90)
    expect(r.peakTestKwhPerDay).toBeCloseTo(81)
  })
  it('computes efficiency, cover rate and abnormal days', () => {
    const [a, b] = plant.daily.map((d) => withMetrics(d, r))
    expect(a.efficiency).toBeCloseTo(100 / 90)
    expect(a.abnormal).toBe(false)
    expect(b.efficiency).toBeCloseTo(50 / 90)
    expect(b.abnormal).toBe(true)
    expect(a.coverRate).toBeCloseTo(10)
  })
  it('respects user overrides', () => {
    const o = resolve(plant, withDefaults({ kWp: 100, peakTestKwhPerDay: 300 }))
    expect(o.kWpAuto).toBe(false)
    expect(o.simulatePerDay).toBeCloseTo(360)
    expect(o.peakTestKwhPerDay).toBe(300)
  })
  it('formats age as years + months', () => {
    expect(formatYM(6.42)).toBe('6Y5M')
    expect(formatYM(6.99)).toBe('7Y0M')
  })
})

describe('bep', () => {
  it('pays back on plan when production equals simulate', () => {
    const p = plantOf([day('2026-01-01', 90)])
    const res = bep(p, resolve(p, withDefaults({ kWp: 25 })))
    expect(res.bepYears).toBeCloseTo(7, 1)
    expect(Math.abs(res.fasterPct ?? 99)).toBeLessThan(1)
    expect(res.years[0].year).toBe(2020)
    expect(res.years.some((y) => y.projected)).toBe(true)
  })
  it('pays back faster when production beats plan', () => {
    const p = plantOf([day('2026-01-01', 180)])
    const res = bep(p, resolve(p, withDefaults({ kWp: 25 })))
    expect(res.bepYears).toBeCloseTo(3.5, 1)
    expect(res.fasterPct).toBeCloseTo(50, 0)
  })
})

describe('settings', () => {
  it('falls back to defaults on bad values', () => {
    const s = withDefaults({ tariff: -1, sunHours: NaN, startDate: '1/1/2020', kWp: 0, name: '  MH  ' } as Partial<PlantSettings>)
    expect(s.tariff).toBe(4.5)
    expect(s.sunHours).toBe(4.5)
    expect(s.startDate).toBe('2020-10-01')
    expect(s.kWp).toBeNull()
    expect(s.name).toBe('MH')
  })
  it('round-trips through storage and survives garbage', () => {
    const mem = new Map<string, string>()
    const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    expect(saveSettings({ MH: { tariff: 5 } }, kv)).toBe(true)
    expect(loadSettings(kv)).toEqual({ MH: { tariff: 5 } })
    expect(loadSettings({ getItem: () => '{broken', setItem: () => {} })).toEqual({})
    expect(loadSettings(null)).toEqual({})
  })
})

describe('sample data (synthetic, committed)', () => {
  it('parses into 6 clean months', () => {
    const r = parseCsv(read('sample-MH.csv'))
    expect(r.rows).toBe(17472)
    expect(r.minProduced).toBeGreaterThanOrEqual(0)
    expect(toMonthly(r.daily)).toHaveLength(6)
  })
})

describe.skipIf(!realFile)('real CSV (local only, never committed)', () => {
  const r = realFile ? parseCsv(read(realFile)) : null
  it('reads every 15-min row of the 6-month export', () => {
    expect(r!.rows).toBe(17472)
    expect(r!.skipped).toBe(0)
    expect(r!.first).toBe('2025-12-01 00:00')
    expect(r!.last).toBe('2026-05-31 23:45')
    expect(r!.intervalMin).toBe(15)
    expect(r!.minProduced).toBeGreaterThanOrEqual(0)
    expect(toMonthly(r!.daily).map((m) => m.key)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])
  })
  it('cover rate is produced / consumed', () => {
    const plant: Plant = { id: 'MH', name: 'MH', daily: r!.daily, source: realFile! }
    const res = resolve(plant, DEFAULT_SETTINGS)
    const total = withMetrics(sumRows(r!.daily), res)
    expect(total.coverRate).toBeCloseTo(total.produced / total.consumed, 10)
    const b = bep(plant, res)
    console.info(
      `[real] kWp≈${res.kWp} eff=${(total.efficiency! * 100).toFixed(1)}% cover=${(total.coverRate! * 100).toFixed(1)}% ` +
        `abnormalDays=${r!.daily.filter((d) => withMetrics(d, res).abnormal).length} bep=${b.bepYears?.toFixed(2)}y`,
    )
  })
})

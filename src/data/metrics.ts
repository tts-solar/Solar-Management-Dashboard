import type { DailyRow, PeriodRow, Plant } from './types'
import { dateFromNumber, dayNumber, yearOf } from './aggregate'
import { PEAK_TO_KWP, type PlantSettings } from './settings'

/** Settings with every "auto" value worked out for one plant. */
export interface Resolved extends PlantSettings {
  kWp: number
  kWpAuto: boolean
  /** expected kWh per day = kWp × sun hours × performance ratio */
  simulatePerDay: number
  peakTestKwhPerDay: number
  investment: number
  investmentAuto: boolean
}

export const maxPeakKw = (daily: DailyRow[]): number => daily.reduce((m, d) => Math.max(m, d.peakKw), 0)

export function resolve(plant: Plant, s: PlantSettings): Resolved {
  const kWp = s.kWp ?? Math.round((maxPeakKw(plant.daily) / PEAK_TO_KWP) * 10) / 10
  const simulatePerDay = kWp * s.sunHours * s.performanceRatio
  const investment =
    s.investment ?? Math.round((simulatePerDay * 365 * s.tariff * s.paybackPlanYears) / 1000) * 1000
  return {
    ...s,
    kWp,
    kWpAuto: s.kWp === null,
    simulatePerDay,
    peakTestKwhPerDay: s.peakTestKwhPerDay ?? simulatePerDay * s.peakTestFactor,
    investment,
    investmentAuto: s.investment === null,
  }
}

export interface MetricRow {
  key: string
  produced: number
  consumed: number
  exported: number
  imported: number
  days: number
  simulate: number
  peakTest: number
  /** produced ÷ simulate */
  efficiency: number | null
  /** produced ÷ consumed ("Used Cover Rate") */
  coverRate: number | null
  abnormal: boolean
}

export function withMetrics(row: DailyRow | PeriodRow, r: Resolved): MetricRow {
  const days = 'days' in row ? row.days : 1
  const simulate = r.simulatePerDay * days
  const efficiency = simulate > 0 ? row.produced / simulate : null
  return {
    key: 'key' in row ? row.key : row.date,
    produced: row.produced,
    consumed: row.consumed,
    exported: row.exported,
    imported: row.imported,
    days,
    simulate,
    peakTest: r.peakTestKwhPerDay * days,
    efficiency,
    coverRate: row.consumed > 0 ? row.produced / row.consumed : null,
    abnormal: efficiency !== null && efficiency < r.abnormalBelow,
  }
}

export function cumulative(values: number[]): number[] {
  let sum = 0
  return values.map((v) => (sum += v))
}

export const ageYears = (startDate: string, asOf: string): number =>
  Math.max(0, (dayNumber(asOf) - dayNumber(startDate)) / 365.25)

/** 6.42 → "6Y5M" */
export function formatYM(years: number): string {
  let y = Math.floor(years)
  let m = Math.round((years - y) * 12)
  if (m === 12) {
    y++
    m = 0
  }
  return `${y}Y${m}M`
}

export interface BepYear {
  year: number
  /** cumulative THB saved by the end of this year */
  savings: number
  /** cumulative THB the plan (simulate) expects */
  simulate: number
  investment: number
  /** some days of this year are estimated (no CSV data) → drawn dashed */
  projected: boolean
}

export interface BepResult {
  years: BepYear[]
  bepYears: number | null
  bepDate: string | null
  planYears: number
  /** % faster than plan (negative = slower) */
  fasterPct: number | null
  ageYears: number
  avgDailyProduced: number
}

/**
 * Break-even: walk day by day from commissioning. Days with CSV data use the real kWh;
 * days without use the average of the available data (projected, drawn dashed).
 */
export function bep(plant: Plant, r: Resolved, asOf?: string): BepResult {
  const actual = new Map(plant.daily.map((d) => [d.date, d.produced]))
  const avg = plant.daily.length ? plant.daily.reduce((s, d) => s + d.produced, 0) / plant.daily.length : 0
  const lastData = plant.daily[plant.daily.length - 1]?.date
  const start = dayNumber(r.startDate)
  const startYear = +yearOf(r.startDate)
  const lastYear = Math.max(startYear + Math.ceil(r.paybackPlanYears), lastData ? +yearOf(lastData) : startYear)
  const hardStop = startYear + 40

  const years: BepYear[] = []
  let savings = 0
  let simulate = 0
  let bepDay: number | null = null
  let year = startYear
  let projected = false
  for (let n = start; ; n++) {
    const date = dateFromNumber(n)
    const y = +date.slice(0, 4)
    if (y !== year) {
      years.push({ year, savings, simulate, investment: r.investment, projected })
      if ((year >= lastYear && bepDay !== null) || year >= hardStop) break
      year = y
      projected = false
    }
    const p = actual.get(date)
    if (p === undefined) projected = true
    savings += (p ?? avg) * r.tariff
    simulate += r.simulatePerDay * r.tariff
    // investment 0 means "unknown" (no data to size it) — never report an instant payback
    if (bepDay === null && r.investment > 0 && savings >= r.investment) bepDay = n - start + 1
  }

  const bepYears = bepDay === null ? null : bepDay / 365.25
  return {
    years,
    bepYears,
    bepDate: bepDay === null ? null : dateFromNumber(start + bepDay - 1),
    planYears: r.paybackPlanYears,
    fasterPct: bepYears === null ? null : ((r.paybackPlanYears - bepYears) / r.paybackPlanYears) * 100,
    ageYears: ageYears(r.startDate, asOf ?? lastData ?? r.startDate),
    avgDailyProduced: avg,
  }
}

import type { DailyRow, PeriodRow, Plant } from './types'
import { dateFromNumber, dayNumber, yearOf } from './aggregate'
import { avgTariff, PEAK_TO_KWP, tariffForDate, type PlantSettings } from './settings'

/** Settings with every "auto" value worked out for one plant. */
export interface Resolved extends PlantSettings {
  kWp: number
  kWpAuto: boolean
  /** expected kWh per day = kWp × sun hours × performance ratio */
  simulatePerDay: number
  peakTestKwhPerDay: number
  investment: number
  investmentAuto: boolean
  startDate: string
  startDateAuto: boolean
}

/** A daily peak kW above median × this is a gross corrupt reading, dropped before anything else. */
const SPIKE_FACTOR = 10
/** After gross spikes are gone, capacity is this percentile of the daily peaks — trims residual noise. */
const PEAK_PERCENTILE = 0.99

const median = (values: number[]): number => {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Nearest-rank percentile (q in 0..1) of an unsorted list; [] → 0. */
const percentile = (values: number[], q: number): number => {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return s[i]
}

/**
 * The plant's real peak kW, in two robust passes so neither a lone giant spike nor a cluster of
 * milder corrupt readings inflates the capacity estimate:
 *   1. drop any day above median × SPIKE_FACTOR — kills a gross spike even in a short series
 *      (the median is unmoved by one outlier),
 *   2. take the PEAK_PERCENTILE-th percentile of what survives — ignores the top ~1% as residual
 *      noise. Real daily peaks sit within ~1.5× the median, so trimming the tail loses no capacity.
 * At small n p99 ≈ max, so pass 1 does the rejecting; at large n pass 2 adds the fine trim.
 */
export const robustPeakKw = (daily: DailyRow[]): number => {
  const peaks = daily.map((d) => d.peakKw).filter((v) => v > 0)
  if (!peaks.length) return 0
  const cap = median(peaks) * SPIKE_FACTOR
  return percentile(
    peaks.filter((v) => v <= cap),
    PEAK_PERCENTILE,
  )
}

export function resolve(plant: Plant, s: PlantSettings): Resolved {
  const kWp = s.kWp ?? Math.round((robustPeakKw(plant.daily) / PEAK_TO_KWP) * 10) / 10
  const simulatePerDay = kWp * s.sunHours * s.performanceRatio
  const investment =
    s.investment ?? Math.round((simulatePerDay * 365 * avgTariff(s) * s.paybackPlanYears) / 1000) * 1000
  // no commissioning date set → start from the first day of real data (plant.daily is sorted ascending)
  const startDate = s.startDate ?? plant.daily[0]?.date ?? '2020-10-01'
  return {
    ...s,
    kWp,
    kWpAuto: s.kWp === null,
    simulatePerDay,
    peakTestKwhPerDay: s.peakTestKwhPerDay ?? simulatePerDay * s.peakTestFactor,
    investment,
    investmentAuto: s.investment === null,
    startDate,
    startDateAuto: s.startDate === null,
  }
}

/**
 * Expected kWh for ONE day, by date. When the plant has the supplier's yearly figures, the day takes
 * that project-year's value ÷ 365; a year with no supplier figure (0/blank) falls back to the
 * kWp×sunHours×PR formula. No supplier data at all → the formula, exactly as before.
 * Project year is 0-based: the first year after the commissioning date is index 0.
 */
export function simulatePerDayOn(r: Resolved, date: string): number {
  const sy = r.supplierYearly
  if (sy && sy.length) {
    const idx = Math.floor(ageYears(r.startDate, date))
    const kwh = idx >= 0 && idx < sy.length ? sy[idx] : 0
    if (kwh > 0) return kwh / 365
  }
  return r.simulatePerDay
}

/**
 * Supplier-aware expected kWh for a row, or null to mean "use the plain formula". With supplier data we
 * sum the per-day rate over the row's REAL data days (so efficiency compares like with like): a daily
 * row is its own date; a period row needs its aggregated `rows` passed in — without them we fall back to
 * the formula rather than guess the span.
 */
function supplierSimulate(row: DailyRow | PeriodRow, r: Resolved, rows?: readonly DailyRow[]): number | null {
  if (!r.supplierYearly?.some((v) => v > 0)) return null
  if (!('days' in row)) return simulatePerDayOn(r, row.date)
  if (!rows) return null
  return rows.reduce((s, d) => s + simulatePerDayOn(r, d.date), 0)
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

/**
 * `rows` (optional) = the real daily rows a PERIOD row aggregates. Pass them when the plant may have
 * supplier yearly figures so the expected kWh is summed per day/project-year; omit for a daily row or
 * when no supplier data applies (then the plain formula is used — unchanged behaviour).
 */
export function withMetrics(row: DailyRow | PeriodRow, r: Resolved, rows?: readonly DailyRow[]): MetricRow {
  const days = 'days' in row ? row.days : 1
  const simulate = supplierSimulate(row, r, rows) ?? r.simulatePerDay * days
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
    const tariff = tariffForDate(r, date, startYear)
    savings += (p ?? avg) * tariff
    simulate += simulatePerDayOn(r, date) * tariff
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
    // display age, computed from the commissioning date (does not affect the payback math above)
    ageYears: ageYears(r.startDate, asOf ?? lastData ?? r.startDate),
    avgDailyProduced: avg,
  }
}

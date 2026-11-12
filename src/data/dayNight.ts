import type { DailyRow } from './types'

/** Which part of the day the dashboard is showing. */
export type TimeOfDay = 'all' | 'day' | 'night'

/** Daytime window as whole hours: day = [start, end) on a 0–24 clock (e.g. 6→18 = 06:00–18:00). */
export interface DayBoundary {
  start: number // first daytime hour, 0–23
  end: number // end hour, exclusive, 1–24
}

/** Used when a plant has no hourly data to read a boundary from. */
export const DEFAULT_BOUNDARY: DayBoundary = { start: 6, end: 18 }

/** Does this data carry per-hour bins? Plants imported before the feature don't. */
export const hasHourly = (daily: DailyRow[]): boolean => daily.some((d) => d.hourly?.length === 24)

/**
 * Daytime window inferred from WHEN the sun actually produces: average each hour's production across
 * every day, then take the span of hours that clear a floor (5% of the peak hour). Day = [first, last+1).
 * No hourly data or no production anywhere → DEFAULT_BOUNDARY.
 */
export function autoBoundary(daily: DailyRow[]): DayBoundary {
  const sum = new Array(24).fill(0)
  let n = 0
  for (const d of daily) {
    if (d.hourly?.length !== 24) continue
    n++
    for (let h = 0; h < 24; h++) sum[h] += d.hourly[h].produced
  }
  if (!n) return DEFAULT_BOUNDARY
  const peak = Math.max(...sum)
  if (peak <= 0) return DEFAULT_BOUNDARY
  const floor = peak * 0.05
  let start = -1
  let end = -1
  for (let h = 0; h < 24; h++) {
    if (sum[h] >= floor) {
      if (start < 0) start = h
      end = h + 1
    }
  }
  return start < 0 ? DEFAULT_BOUNDARY : { start, end }
}

/** Is hour `h` inside the daytime window [start, end)? */
const isDay = (h: number, b: DayBoundary): boolean => h >= b.start && h < b.end

/**
 * Re-total one day over only the hours in the selected part of the day. "all", or a day with no hourly
 * bins, returns the row unchanged. peakKw becomes the busiest kept hour's average kW (we no longer have
 * the sub-hour peak once filtered); "all" keeps the stored 15-min peak.
 */
export function filterDay(row: DailyRow, period: TimeOfDay, b: DayBoundary): DailyRow {
  if (period === 'all' || row.hourly?.length !== 24) return row
  const keep = (h: number): boolean => (period === 'day' ? isDay(h, b) : !isDay(h, b))
  let produced = 0
  let consumed = 0
  let exported = 0
  let imported = 0
  let peakKw = 0
  let samples = 0
  for (let h = 0; h < 24; h++) {
    if (!keep(h)) continue
    const bin = row.hourly[h]
    produced += bin.produced
    consumed += bin.consumed
    exported += bin.exported
    imported += bin.imported
    samples += bin.samples
    peakKw = Math.max(peakKw, bin.produced) // hour's kWh over 1h = its average kW
  }
  return { ...row, produced, consumed, exported, imported, peakKw, samples }
}

/** Apply {@link filterDay} to every row. "all" returns the input array untouched (no behaviour change). */
export const filterDaily = (daily: DailyRow[], period: TimeOfDay, b: DayBoundary): DailyRow[] =>
  period === 'all' ? daily : daily.map((d) => filterDay(d, period, b))

/** '06:00' for 6; 24 → '00:00', since a window ending at 24 ends at midnight. */
const hh = (h: number): string => `${String(h % 24).padStart(2, '0')}:00`

/**
 * How a report names the part of the day its numbers were totalled over, e.g. 'กลางวัน 06:00–18:00'.
 * Night is the same window read the other way round, so both labels always name one boundary.
 */
export function todLabel(period: TimeOfDay, b: DayBoundary): string {
  if (period === 'all') return 'ทั้งวัน'
  return period === 'day' ? `กลางวัน ${hh(b.start)}–${hh(b.end)}` : `กลางคืน ${hh(b.end)}–${hh(b.start)}`
}

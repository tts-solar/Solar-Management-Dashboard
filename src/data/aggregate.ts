import type { DailyRow, PeriodRow } from './types'

export const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The two "days in a year" constants, named apart because they answer different questions and the
 * right one is NOT a matter of taste:
 *   - DAYS_PER_YEAR turns a PER-DAY RATE into a per-year one (kWh/day → kWh/year, ฿/day → ฿/year).
 *     A year holds 365 of those days; 365.25 here would quietly invent a 366th day of energy.
 *   - DAYS_PER_CALENDAR_YEAR turns a COUNT OF ELAPSED DAYS into years (plant age, break-even).
 *     That is calendar arithmetic, and leap days are real days, so the mean year length applies.
 * Both values are unchanged from the literals they replace — only the intent is now written down.
 */
export const DAYS_PER_YEAR = 365
export const DAYS_PER_CALENDAR_YEAR = 365.25

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD string (UTC maths, no locale parsing). */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

export function dateFromNumber(n: number): string {
  const d = new Date(n * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const monthOf = (date: string): string => date.slice(0, 7)
export const yearOf = (date: string): string => date.slice(0, 4)

/** Sum daily rows per key; input is date-sorted so groups come out in order. */
export function groupBy(daily: DailyRow[], keyOf: (date: string) => string): PeriodRow[] {
  const out = new Map<string, PeriodRow>()
  for (const d of daily) {
    const key = keyOf(d.date)
    let r = out.get(key)
    if (!r) {
      r = { key, produced: 0, consumed: 0, exported: 0, imported: 0, days: 0, peakKw: 0 }
      out.set(key, r)
    }
    r.produced += d.produced
    r.consumed += d.consumed
    r.exported += d.exported
    r.imported += d.imported
    r.days++
    r.peakKw = Math.max(r.peakKw, d.peakKw)
  }
  return [...out.values()]
}

export const toMonthly = (daily: DailyRow[]): PeriodRow[] => groupBy(daily, monthOf)
export const toYearly = (daily: DailyRow[]): PeriodRow[] => groupBy(daily, yearOf)

export function sumRows(daily: DailyRow[]): PeriodRow {
  return (
    groupBy(daily, () => 'total')[0] ?? {
      key: 'total', produced: 0, consumed: 0, exported: 0, imported: 0, days: 0, peakKw: 0,
    }
  )
}

/** Rows whose date starts with a "YYYY" or "YYYY-MM" prefix. */
export const inPeriod = (daily: DailyRow[], prefix: string): DailyRow[] =>
  daily.filter((d) => d.date.startsWith(prefix))

/**
 * Rows whose date falls in [start, end] inclusive. Dates are YYYY-MM-DD, so a plain string compare
 * orders them correctly — no Date parsing needed.
 */
export const inRange = (daily: DailyRow[], start: string, end: string): DailyRow[] =>
  daily.filter((d) => d.date >= start && d.date <= end)

/** Whole days covered by [start, end] inclusive (both YYYY-MM-DD). */
export const rangeDays = (start: string, end: string): number => dayNumber(end) - dayNumber(start) + 1

/**
 * A custom range up to this many days is grouped day-by-day on the X axis; longer ranges switch to
 * monthly so the chart stays readable (≈ two months of daily points is the comfortable ceiling).
 */
export const RANGE_DAILY_MAX = 62

/** True when a custom range is short enough to plot one point per day (else group by month). */
export const rangeIsDaily = (start: string, end: string): boolean =>
  rangeDays(start, end) <= RANGE_DAILY_MAX

export const yearsOf = (daily: DailyRow[]): string[] => [...new Set(daily.map((d) => yearOf(d.date)))]

export const monthsOf = (daily: DailyRow[], year?: string): string[] =>
  [...new Set(daily.map((d) => monthOf(d.date)))].filter((m) => !year || m.startsWith(year))

// Does this data have sub-month (day-level) resolution? Monthly reports fold a whole month into one
// row dated the 1st, so a date-range / day filter over them is meaningless (and the day pickers would
// let the user pick mid-month days that match nothing). Interval/daily imports land on real calendar
// days, so at least one row is not a month-start. We gate the "ช่วงวัน" date-range filter on this.
export const hasDailyDetail = (daily: DailyRow[]): boolean => daily.some((d) => !d.date.endsWith('-01'))

/**
 * Calendar days a set of rows COVERS — the one conversion between "a row" and "a day".
 *
 * Interval/daily imports carry one row per real calendar day, so that is simply the row count. A
 * monthly Plant Report folds a whole month into one row dated the 1st (see report.ts), so each of its
 * rows stands for however many days that month has. Anything that turns totals into a per-day figure
 * (the advisor's averages, kWh/day per added kW, × 365 a year) must divide by THIS, never by
 * `daily.length`, or a month's total is reported as a day's.
 *
 * The daily/monthly test is `hasDailyDetail`, the same one that gates the date-range filter, so the
 * two never disagree. `DailyRow.samples` deliberately plays no part: it counts raw intervals for a CSV
 * import but days-in-month for a monthly report, so it cannot answer this question.
 */
export function spanDays(daily: DailyRow[]): number {
  if (!daily.length) return 0
  const dates = [...new Set(daily.map((d) => d.date))] // a repeated date is one day, not two
  if (hasDailyDetail(daily)) return dates.length
  return dates.reduce((n, date) => n + daysInMonth(+date.slice(0, 4), +date.slice(5, 7)), 0)
}

import type { DailyRow, PeriodRow } from './types'

export const pad = (n: number): string => String(n).padStart(2, '0')

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

export const yearsOf = (daily: DailyRow[]): string[] => [...new Set(daily.map((d) => yearOf(d.date)))]

export const monthsOf = (daily: DailyRow[], year?: string): string[] =>
  [...new Set(daily.map((d) => monthOf(d.date)))].filter((m) => !year || m.startsWith(year))

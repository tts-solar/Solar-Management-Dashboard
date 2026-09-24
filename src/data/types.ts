/** Shared data shapes. All energy values are kWh. */

/** One calendar day of energy totals. */
export interface DailyRow {
  date: string // YYYY-MM-DD
  produced: number
  consumed: number
  exported: number
  imported: number
  /** highest interval-average power that day, kW */
  peakKw: number
  /** raw CSV intervals folded into this day */
  samples: number
}

/** Totals for a month ("YYYY-MM"), year ("YYYY") or any other grouping key. */
export interface PeriodRow {
  key: string
  produced: number
  consumed: number
  exported: number
  imported: number
  /** days with data inside the period */
  days: number
  peakKw: number
}

export interface Plant {
  id: string
  name: string
  daily: DailyRow[] // sorted by date
  source: string // original file name
}

export interface ParseResult {
  daily: DailyRow[]
  rows: number
  skipped: number
  /** negative readings forced to 0 (inverter standby draw at night) */
  clamped: number
  minProduced: number
  intervalMin: number
  first: string // "YYYY-MM-DD HH:mm"
  last: string
}

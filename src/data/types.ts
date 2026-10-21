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

/**
 * One time-of-day slot of a representative day, averaged across every day in the file. kWh.
 * Lets the advisor size storage from WHEN energy flows, not just the daily total (csv.ts keeps it).
 */
export interface ProfileSlot {
  minute: number // minutes since midnight (0, 15, 30, …)
  produced: number
  consumed: number
  exported: number
  imported: number
}
export type DayProfile = ProfileSlot[] // sorted by minute

export interface Plant {
  id: string
  name: string
  daily: DailyRow[] // sorted by date
  source: string // original file name
  /** average-day shape at the logging interval; absent on plants imported before profiles existed */
  profile?: DayProfile
}

export interface ParseResult {
  daily: DailyRow[]
  /** average-day shape at the logging interval, built from the raw intervals before they are folded */
  profile: DayProfile
  rows: number
  skipped: number
  /** negative readings forced to 0 (inverter standby draw at night) */
  clamped: number
  minProduced: number
  intervalMin: number
  first: string // "YYYY-MM-DD HH:mm"
  last: string
}

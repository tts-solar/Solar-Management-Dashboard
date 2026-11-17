import type { SupplierYear } from './settings'

/**
 * Reads the supplier's projection back off a spreadsheet: the four columns their document prints,
 * one row per year. It is the other half of `supplierXlsx.ts`, which writes the workbook the download
 * button hands out — but this side stays format-agnostic on purpose, taking the plain grid that either
 * a .csv or an .xlsx is read into, so a file typed up by hand is read exactly like one we wrote.
 *
 * Rows are matched by the CALENDAR YEAR in the first column, not by position, so a row deleted or
 * re-sorted in Excel still lands on the year it names. Columns are matched by what their header says
 * rather than by order, the same way the monthly Plant Report is read — a file that comes back with
 * its columns rearranged is still readable, and one with a column missing simply leaves that number
 * empty instead of silently shifting the others along.
 */

type Col = 'year' | 'peakRate' | 'peakKwh' | 'offRate' | 'offKwh'

const isOff = (h: string): boolean => /off[\s-]*peak|นอกช่วง|ออฟพีค/i.test(h)
const isRate = (h: string): boolean => /rate|price|ราคา|อัตรา|฿|thb|baht|บาท/i.test(h)
const isEnergy = (h: string): boolean => /energy|kwh|unit|หน่วย|พลังงาน|ผลิต/i.test(h)
const isPeak = (h: string): boolean => /peak|พีค|ช่วง/i.test(h)

/** Header → column. Each test is written so "Off-Peak Rate" can never win the plain "Peak Rate" slot. */
const MATCH: Array<[Col, (h: string) => boolean]> = [
  ['year', (h) => /^\s*(ปี|ปีที่|year)\s*$/i.test(h.trim())],
  ['offRate', (h) => isOff(h) && isRate(h)],
  ['offKwh', (h) => isOff(h) && isEnergy(h)],
  ['peakRate', (h) => !isOff(h) && isPeak(h) && isRate(h)],
  ['peakKwh', (h) => !isOff(h) && isPeak(h) && isEnergy(h)],
]

const YEAR_RE = /^\s*(\d{4})\s*$/

/** First finite positive number in a cell, else 0 (blank / "-" / text → 0, i.e. "use the formula"). */
function num(cell: string | undefined): number {
  const v = Number((cell ?? '').replace(/[,\s฿]/g, '').trim())
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** The header row of a supplier sheet: it names a year column and at least one energy column. */
function headerRowOf(grid: string[][]): number {
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i]
    const has = (col: Col): boolean => row.some((cell) => MATCH.find(([c]) => c === col)![1](cell))
    if (has('year') && (has('peakKwh') || has('offKwh'))) return i
  }
  return -1
}

/** True when a grid looks like this file rather than a Plant Report or an interval export. */
export function isSupplierGrid(grid: string[][]): boolean {
  const i = headerRowOf(grid)
  if (i < 0) return false
  const yearCol = grid[i].findIndex((cell) => MATCH[0][1](cell))
  return grid.slice(i + 1).some((row) => YEAR_RE.test(row[yearCol] ?? ''))
}

export interface ParsedSupplier {
  /** Indexed by project year, 0 = `startYear`; years before it or past the table are reported, not kept. */
  years: SupplierYear[]
  /** How many years came back with energy in them. */
  filled: number
  /** Rows naming a year outside the table (before commissioning, or further out than the table runs). */
  skipped: number
}

/**
 * Read a supplier sheet. `startYear` is the commissioning year, so a row naming 2024 with a 2024 start
 * lands at index 0. A row for a year before that, or beyond `maxYears`, is counted in `skipped` rather
 * than quietly dropped — the dialog tells the user, because a silently ignored row is the same class of
 * mistake as a column entered into the wrong box.
 */
export function parseSupplierGrid(grid: string[][], startYear: number, maxYears = 60): ParsedSupplier {
  const h = headerRowOf(grid)
  if (h < 0) return { years: [], filled: 0, skipped: 0 }
  const header = grid[h]
  const col = new Map<Col, number>()
  for (const [name, test] of MATCH) {
    const idx = header.findIndex((cell, i) => !([...col.values()].includes(i)) && test(cell))
    if (idx >= 0) col.set(name, idx)
  }
  const yearCol = col.get('year')
  if (yearCol === undefined) return { years: [], filled: 0, skipped: 0 }

  const years: SupplierYear[] = []
  let skipped = 0
  for (const row of grid.slice(h + 1)) {
    const m = YEAR_RE.exec(row[yearCol] ?? '')
    if (!m) continue
    const idx = +m[1] - startYear
    if (idx < 0 || idx >= maxYears) {
      skipped++
      continue
    }
    const at = (c: Col): number => {
      const i = col.get(c)
      return i === undefined ? 0 : num(row[i])
    }
    while (years.length <= idx) years.push({ peakRate: 0, peakKwh: 0, offRate: 0, offKwh: 0 })
    years[idx] = { peakRate: at('peakRate'), peakKwh: at('peakKwh'), offRate: at('offRate'), offKwh: at('offKwh') }
  }
  return { years, filled: years.filter((y) => y.peakKwh + y.offKwh > 0).length, skipped }
}

import { daysInMonth } from './aggregate'
import { CsvError } from './csv'
import type { DailyRow } from './types'

/**
 * Read a monthly "Plant Report" spreadsheet (as exported by the solar monitoring portal) into the
 * dashboard's daily model. These reports are ONE ROW PER MONTH of aggregated figures — PV Yield,
 * Consumption, Export, Import, Peak Power — not the 15-minute interval CSVs the portal also exports.
 *
 * Mapping choice: each month becomes a single {@link DailyRow} dated to the 1st of that month, so the
 * existing monthly/yearly rollups (toMonthly/toYearly) sum to the exact reported figures with no UI
 * change. The per-day view of such a plant is necessarily coarse (one point per month) — that is the
 * true resolution of the source, not a bug.
 */

export interface ParsedReport {
  id: string
  name: string
  daily: DailyRow[]
  months: number // month rows read
  skipped: number // rows that looked like data but had no usable month
}

type Field = 'produced' | 'consumed' | 'exported' | 'imported' | 'peak'

// Header → field. Each predicate is specific enough to beat the look-alikes in the same report
// (e.g. "Self-consumption" must not win "Consumption"; "Loss Due to Export Limitation" must not win
// "Export"). Thai synonyms included for portals localized to Thai.
const FIELD_MATCHERS: Array<[Field, (h: string) => boolean]> = [
  ['produced', (h) => /pv\s*yield|produc|generat|ผลิต/i.test(h)],
  ['consumed', (h) => /consum|ใช้ไฟ/i.test(h) && !/self|rate|อัตรา/i.test(h)],
  ['exported', (h) => /export|ขายไฟ|ส่งออก/i.test(h) && !/loss|limit|rate/i.test(h)],
  ['imported', (h) => /import|ซื้อไฟ|นำเข้า/i.test(h)],
  ['peak', (h) => /peak\s*power|กำลังสูงสุด/i.test(h)],
]

const PERIOD_RE = /^\s*(\d{4})[-/](\d{1,2})\s*$/ // "2022-10" or "2022/10"
const isPeriodHeader = (h: string): boolean => /statistical\s*period|period|month|เดือน|date|วันที่/i.test(h)

/** First non-empty, finite number parsed from a cell, else 0 (blank/"-"/text → 0). */
function num(cell: string | undefined): number {
  const v = Number((cell ?? '').replace(/,/g, '').trim())
  return Number.isFinite(v) ? v : 0
}

/** A plant name from the report file name: "Plant Report - SC Tower 2024.xlsx" → "SC Tower". */
export function plantNameFromReport(fileName: string): string {
  const name = fileName
    .replace(/\.[^.]+$/, '') // extension
    .replace(/plant\s*report/i, '') // the boilerplate label
    .replace(/[_\-–—]+/g, ' ') // separators → spaces first, so a year after "_" is seen as its own word
    .replace(/\b(19|20)\d{2}\b/g, '') // a year anywhere
    .replace(/\s+/g, ' ')
    .trim()
  return name || 'Plant'
}

/**
 * True when a grid looks like a monthly Plant Report: a header row that names the period and a
 * PV-yield column, followed by at least one YYYY-MM data row. Lets the CSV importer tell a monthly
 * report apart from an interval export (whose date cells carry a full datetime, never a bare YYYY-MM)
 * and route it to {@link parsePlantReport}.
 */
export function isMonthlyReportGrid(grid: string[][]): boolean {
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i]
    if (!row.some(isPeriodHeader) || !row.some((c) => FIELD_MATCHERS[0][1](c))) continue
    const periodCol = row.findIndex(isPeriodHeader)
    for (let j = i + 1; j < grid.length; j++) if (PERIOD_RE.test(grid[j][periodCol] ?? '')) return true
    return false
  }
  return false
}

/**
 * Parse a grid (from {@link readXlsxGrid}) as a monthly Plant Report. Throws {@link CsvError} with a
 * Thai message when it is not a recognizable report (missing header row or no PV-yield column).
 */
export function parsePlantReport(grid: string[][], fileName: string): ParsedReport {
  // Find the header row: the one that names the period and at least one energy column.
  let headerRow = -1
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i]
    if (row.some(isPeriodHeader) && row.some((c) => FIELD_MATCHERS[0][1](c))) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) {
    throw new CsvError('ไม่พบหัวตารางรายงานรายเดือน (ต้องมีคอลัมน์ Statistical Period และ PV Yield)')
  }

  const header = grid[headerRow]
  const periodCol = header.findIndex(isPeriodHeader)
  const col = new Map<Field, number>()
  header.forEach((h, i) => {
    for (const [field, test] of FIELD_MATCHERS) if (!col.has(field) && test(h)) col.set(field, i)
  })
  if (!col.has('produced')) {
    throw new CsvError('ไม่พบคอลัมน์ PV Yield (พลังงานที่ผลิต) ในรายงาน')
  }

  const daily: DailyRow[] = []
  let skipped = 0
  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i]
    const m = PERIOD_RE.exec(row[periodCol] ?? '')
    if (!m) {
      // ignore fully-blank rows; count rows that carry numbers but no readable month
      if (row.some((c) => c.trim() !== '')) skipped++
      continue
    }
    const year = +m[1]
    const month = +m[2]
    if (month < 1 || month > 12) {
      skipped++
      continue
    }
    const get = (f: Field): number => (col.has(f) ? num(row[col.get(f)!]) : 0)
    daily.push({
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      produced: get('produced'),
      consumed: get('consumed'),
      exported: get('exported'),
      imported: get('imported'),
      peakKw: get('peak'),
      samples: daysInMonth(year, month), // days the month covers (monthly data has no raw intervals)
    })
  }
  if (!daily.length) throw new CsvError('ไม่พบข้อมูลรายเดือนในรายงาน (คอลัมน์ Statistical Period ต้องเป็น YYYY-MM)')

  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const name = plantNameFromReport(fileName)
  return { id: name, name, daily, months: daily.length, skipped }
}

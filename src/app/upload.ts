import { CsvError, csvToGrid, parseCsv, plantIdFromFile } from '../data/csv'
import { isMonthlyReportGrid, parsePlantReport } from '../data/report'
import type { Plant } from '../data/types'
import { readXlsxGrid } from '../data/xlsx'

/** CSV + Excel files → plants, entirely in the browser (nothing is uploaded anywhere). */

export interface Imported {
  plant: Plant
  days: number
  skipped: number
  /** 'month' for monthly Plant Reports (each row is a month), 'day' for interval CSV. Drives wording. */
  granularity: 'day' | 'month'
}

export interface ImportResult {
  ok: Imported[]
  errors: string[] // one Thai message per failed file
}

/** Portal exports are UTF-8; older Thai Excel saves are Windows-874. Try UTF-8 first. */
function decode(buf: ArrayBuffer): string[] {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return [utf8]
  try {
    return [utf8, new TextDecoder('windows-874').decode(buf)]
  } catch {
    return [utf8] // decoder not available
  }
}

const isXlsx = (file: File): boolean => /\.xlsx$/i.test(file.name)

/** A parsed monthly Plant Report grid → a plant (one DailyRow per month), from .xlsx or CSV. */
function monthlyFromGrid(grid: string[][], fileName: string): Imported {
  const r = parsePlantReport(grid, fileName)
  return {
    plant: { id: r.id, name: r.name, daily: r.daily, source: fileName },
    days: r.months,
    skipped: r.skipped,
    granularity: 'month',
  }
}

/** Parse a monthly "Plant Report" .xlsx into a plant (one DailyRow per month). */
async function readReport(file: File): Promise<Imported> {
  return monthlyFromGrid(await readXlsxGrid(await file.arrayBuffer()), file.name)
}

/** Parse one CSV into a plant: a monthly report (one row per month) or an interval export (days
 *  folded from raw intervals), detected from the file's own shape. */
function readCsvFile(file: File, buf: ArrayBuffer): Imported {
  const texts = decode(buf)
  let lastError: unknown
  for (const text of texts) {
    try {
      const grid = csvToGrid(text)
      if (isMonthlyReportGrid(grid)) return monthlyFromGrid(grid, file.name)
      const parsed = parseCsv(text)
      const id = plantIdFromFile(file.name)
      return {
        plant: { id, name: id, daily: parsed.daily, source: file.name, profile: parsed.profile },
        days: parsed.daily.length,
        skipped: parsed.skipped,
        granularity: 'day',
      }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

export async function readPlantFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { ok: [], errors: [] }
  for (const file of files) {
    try {
      result.ok.push(isXlsx(file) ? await readReport(file) : readCsvFile(file, await file.arrayBuffer()))
    } catch (e) {
      const why = e instanceof CsvError ? e.message : 'อ่านไฟล์ไม่ได้'
      result.errors.push(`${file.name}: ${why}`)
    }
  }
  return result
}

import { CsvError, parseCsv, plantIdFromFile } from '../data/csv'
import { parsePlantReport } from '../data/report'
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

/** Parse a monthly "Plant Report" .xlsx into a plant (one DailyRow per month). */
async function readReport(file: File): Promise<Imported> {
  const grid = await readXlsxGrid(await file.arrayBuffer())
  const r = parsePlantReport(grid, file.name)
  return {
    plant: { id: r.id, name: r.name, daily: r.daily, source: file.name },
    days: r.months,
    skipped: r.skipped,
    granularity: 'month',
  }
}

/** Parse one interval CSV into a plant (days folded from the raw intervals). */
function readCsvFile(file: File, buf: ArrayBuffer): Imported {
  const texts = decode(buf)
  let lastError: unknown
  for (const text of texts) {
    try {
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

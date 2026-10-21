import { CsvError, parseCsv, plantIdFromFile } from '../data/csv'
import type { Plant } from '../data/types'

/** CSV files → plants, entirely in the browser (nothing is uploaded anywhere). */

export interface Imported {
  plant: Plant
  days: number
  skipped: number
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

export async function readPlantFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { ok: [], errors: [] }
  for (const file of files) {
    try {
      const texts = decode(await file.arrayBuffer())
      let lastError: unknown
      let done = false
      for (const text of texts) {
        try {
          const parsed = parseCsv(text)
          const id = plantIdFromFile(file.name)
          result.ok.push({
            plant: { id, name: id, daily: parsed.daily, source: file.name, profile: parsed.profile },
            days: parsed.daily.length,
            skipped: parsed.skipped,
          })
          done = true
          break
        } catch (e) {
          lastError = e
        }
      }
      if (!done) throw lastError
    } catch (e) {
      const why = e instanceof CsvError ? e.message : 'อ่านไฟล์ไม่ได้'
      result.errors.push(`${file.name}: ${why}`)
    }
  }
  return result
}

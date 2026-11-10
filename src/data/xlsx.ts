import { CsvError } from './csv'

/**
 * Minimal, dependency-free reader for the one thing the dashboard needs out of an .xlsx file:
 * the first worksheet as a grid of string cells. An .xlsx is a ZIP of XML parts, so this
 * unzips in the browser (native `DecompressionStream`, no library) and pulls the cell values.
 *
 * It is deliberately NOT a general spreadsheet engine — no formulas, styles, dates-as-serials,
 * or multi-sheet logic. It reads shared strings + the first sheet and returns raw text, which
 * `report.ts` then interprets. Everything runs locally; nothing is uploaded.
 */

// ---- ZIP (central directory) ----

interface ZipEntry {
  method: number // 0 = stored, 8 = deflate
  offset: number // local-header offset
  size: number // compressed size
}

const u16 = (dv: DataView, o: number): number => dv.getUint16(o, true)
const u32 = (dv: DataView, o: number): number => dv.getUint32(o, true)

/** Read the ZIP central directory into name → entry. Throws CsvError if the file is not a ZIP. */
function readCentralDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const bytes = new Uint8Array(buf)
  const dv = new DataView(buf)
  // End Of Central Directory: scan back from the end for signature 0x06054b50 (comment may follow).
  let eocd = -1
  const min = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(dv, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new CsvError('ไฟล์ Excel เสียหรือไม่ใช่ .xlsx ที่อ่านได้')

  const entriesCount = u16(dv, eocd + 10)
  let p = u32(dv, eocd + 16) // central-directory offset
  const dec = new TextDecoder('utf-8')
  const out = new Map<string, ZipEntry>()
  for (let i = 0; i < entriesCount; i++) {
    if (u32(dv, p) !== 0x02014b50) break // not a central-dir header → stop
    const method = u16(dv, p + 10)
    const compSize = u32(dv, p + 20)
    const nameLen = u16(dv, p + 28)
    const extraLen = u16(dv, p + 30)
    const commentLen = u16(dv, p + 32)
    const localOffset = u32(dv, p + 42)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    out.set(name, { method, offset: localOffset, size: compSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Raw DEFLATE → bytes, using the platform's built-in streaming decompressor (browser + Node 18+). */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decompress one entry to text. The local header tells us where the data really starts. */
async function readEntryText(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const dv = new DataView(buf)
  if (u32(dv, entry.offset) !== 0x04034b50) throw new CsvError('ไฟล์ Excel เสียหรือไม่ใช่ .xlsx ที่อ่านได้')
  const nameLen = u16(dv, entry.offset + 26)
  const extraLen = u16(dv, entry.offset + 28)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = new Uint8Array(buf, start, entry.size)
  const bytes = entry.method === 0 ? raw : await inflateRaw(raw)
  return new TextDecoder('utf-8').decode(bytes)
}

// ---- XML (just enough of the SpreadsheetML we meet) ----

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays literal

/** Concatenate the text of every <t> inside a chunk (shared-string items can be rich text). */
function textOf(chunk: string): string {
  let out = ''
  const re = /<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g
  for (let m = re.exec(chunk); m; m = re.exec(chunk)) out += m[1] ? unescapeXml(m[1]) : ''
  return out
}

/** The shared-strings table: one string per <si>, indexed by the numbers that `t="s"` cells carry. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1] ? textOf(m[1]) : '')
  return out
}

/** "B" → 1, "AA" → 26. The letters that prefix a cell reference like "B4". */
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break // stop at the first digit
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/** One worksheet → rows of string cells, placed by column so sparse rows keep their alignment. */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
    const row: string[] = []
    const body = rm[1] ?? ''
    for (let cm = cellRe.exec(body); cm; cm = cellRe.exec(body)) {
      const attrs = cm[1]
      const inner = cm[2] ?? ''
      const refM = /\br="([A-Z]+)\d+"/.exec(attrs)
      const col = refM ? colIndex(refM[1]) : row.length
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
      let value = ''
      if (type === 's') {
        const vi = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = vi ? (shared[Number(vi[1])] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = textOf(inner)
      } else {
        const vi = /<v>([\s\S]*?)<\/v>/.exec(inner)
        value = vi ? unescapeXml(vi[1]) : textOf(inner)
      }
      while (row.length < col) row.push('')
      row[col] = value
    }
    rows.push(row)
  }
  return rows
}

/** Read an .xlsx file's first worksheet as a grid of strings. Async (unzip streams). */
export async function readXlsxGrid(buf: ArrayBuffer): Promise<string[][]> {
  const entries = readCentralDirectory(buf)
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(await readEntryText(buf, sharedEntry)) : []
  const sheetName =
    [...entries.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) ??
    [...entries.keys()].find((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
  const sheetEntry = sheetName ? entries.get(sheetName) : undefined
  if (!sheetEntry) throw new CsvError('ไม่พบแผ่นงานในไฟล์ Excel')
  return parseSheet(await readEntryText(buf, sheetEntry), shared)
}

// Exposed for unit tests (XML-level, so tests need no real .xlsx fixture).
export const _internal = { parseSharedStrings, parseSheet, colIndex, unescapeXml }

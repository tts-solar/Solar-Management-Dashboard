import type { SupplierYear } from './settings'

/**
 * Writes the ค่า Simulate table as a real .xlsx file — the same workbook the dialog reads back.
 *
 * CSV was the obvious format and the wrong one: it carries no column widths, so every header arrived
 * clipped to "k Rate (฿/k", and no fill, so the sheet looked nothing like the table it came from.
 * A spreadsheet the user has to repair before reading is a spreadsheet they stop trusting. So this
 * writes the real thing: header row in the app's green, columns wide enough for their own titles,
 * kWh grouped by thousands exactly as the dialog shows them, and the header frozen for scrolling.
 *
 * An .xlsx is a ZIP of XML parts; both are built here by hand rather than with a library, because
 * the whole dashboard ships as one offline HTML file and `xlsx.ts` already reads this format with no
 * dependency either. Entries are STORED (never deflated) — a template is a few kB, and `xlsx.ts`
 * reads method 0 directly, so nothing here needs CompressionStream.
 */

const GREEN = 'FF17594A' // --green, the dialog's own header colour
const LINE = 'FFD8DFDC' // --line

/** Style slots, in the order cellXfs lists them below. */
const S = { plain: 0, head: 1, year: 2, rate: 3, energy: 4 } as const

const COLUMNS: { head: string; width: number; style: number; of: (y: SupplierYear) => number }[] = [
  { head: 'ปี', width: 12, style: S.year, of: () => 0 }, // filled from the year itself
  { head: 'Peak Rate (฿/kWh)', width: 19, style: S.rate, of: (y) => y.peakRate },
  { head: 'Peak Energy (kWh)', width: 19, style: S.energy, of: (y) => y.peakKwh },
  { head: 'Off-Peak Rate (฿/kWh)', width: 23, style: S.rate, of: (y) => y.offRate },
  { head: 'Off-Peak Energy (kWh)', width: 23, style: S.energy, of: (y) => y.offKwh },
]

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "A", "B", … — only ever five columns here, so one letter is enough. */
const colLetter = (i: number): string => String.fromCharCode(65 + i)

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const CONTENT_TYPES =
  `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS =
  `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`

/**
 * The tab carries the plant's name, so a workbook that has been saved, renamed or mailed on still says
 * which plant it belongs to from inside. Excel's own rules on a sheet name are narrow and it refuses
 * to open a file that breaks them, so the name is cut to fit here rather than trusted:
 *   • none of : \ / ? * [ ] and no leading or trailing apostrophe,
 *   • 31 characters at most — a long plant name keeps its own name and drops the suffix,
 *   • never empty, which is what a name made only of forbidden characters would come to.
 */
function sheetName(plantName: string): string {
  const clean = plantName.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim()
  if (!clean) return 'Simulate'
  const full = `${clean} · Simulate`
  return full.length <= 31 ? full : clean.slice(0, 31).trim()
}

const workbookXml = (plantName: string): string =>
  `${DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
  `<sheets><sheet name="${xml(sheetName(plantName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`

/** Two number formats (rate to 3 decimals, energy grouped), the green header, and a hairline grid. */
const STYLES =
  `${DECL}<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  `<fill><patternFill patternType="solid"><fgColor rgb="${GREEN}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  `<border><left style="thin"><color rgb="${LINE}"/></left><right style="thin"><color rgb="${LINE}"/></right>` +
  `<top style="thin"><color rgb="${LINE}"/></top><bottom style="thin"><color rgb="${LINE}"/></bottom><diagonal/></border></borders>` +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
  '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment horizontal="center"/></xf>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

/** One worksheet: the header row, then one row per year the table is showing. */
function sheetXml(startYear: number, years: SupplierYear[], rowCount: number): string {
  const last = rowCount + 1
  const cols = COLUMNS.map(
    (c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`,
  ).join('')
  const head = COLUMNS.map(
    (c, i) => `<c r="${colLetter(i)}1" s="${S.head}" t="inlineStr"><is><t>${xml(c.head)}</t></is></c>`,
  ).join('')

  let body = ''
  for (let k = 0; k < rowCount; k++) {
    const y = years[k]
    const r = k + 2
    const cells = COLUMNS.map((c, i) => {
      const ref = `${colLetter(i)}${r}`
      const v = i === 0 ? startYear + k : y ? c.of(y) : 0
      // A year with nothing in it keeps its formatting and its grid line, and stays empty: the file
      // is a form to fill in as much as it is a backup of what is filled in already.
      return v > 0 ? `<c r="${ref}" s="${c.style}"><v>${v}</v></c>` : `<c r="${ref}" s="${c.style}"/>`
    }).join('')
    body += `<row r="${r}">${cells}</row>`
  }

  return (
    `${DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheetPr><tabColor rgb="${GREEN}"/></sheetPr>` +
    `<dimension ref="A1:${colLetter(COLUMNS.length - 1)}${last}"/>` +
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="17"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1" ht="34" customHeight="1">${head}</row>${body}</sheetData>` +
    '</worksheet>'
  )
}

// ---- ZIP (stored entries only) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Pack named text parts into a ZIP with no compression — what `xlsx.ts` reads back as method 0. */
function zipStored(parts: { name: string; text: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const files = parts.map((p) => {
    const name = enc.encode(p.name)
    const data = enc.encode(p.text)
    return { name, data, crc: crc32(data), offset: 0 }
  })

  const local = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0)
  const central = files.reduce((n, f) => n + 46 + f.name.length, 0)
  const out = new Uint8Array(local + central + 22)
  const dv = new DataView(out.buffer)
  let p = 0
  const put32 = (v: number): void => {
    dv.setUint32(p, v, true)
    p += 4
  }
  const put16 = (v: number): void => {
    dv.setUint16(p, v, true)
    p += 2
  }
  const putBytes = (b: Uint8Array): void => {
    out.set(b, p)
    p += b.length
  }

  for (const f of files) {
    f.offset = p
    put32(0x04034b50)
    put16(20) // version needed
    put16(0x0800) // UTF-8 names
    put16(0) // method 0 = stored
    put16(0) // time
    put16(0x0021) // date = 1980-01-01, so the file is byte-identical every time it is written
    put32(f.crc)
    put32(f.data.length) // compressed size == size
    put32(f.data.length)
    put16(f.name.length)
    put16(0) // extra
    putBytes(f.name)
    putBytes(f.data)
  }

  const dirStart = p
  for (const f of files) {
    put32(0x02014b50)
    put16(20) // made by
    put16(20) // version needed
    put16(0x0800)
    put16(0)
    put16(0)
    put16(0x0021)
    put32(f.crc)
    put32(f.data.length)
    put32(f.data.length)
    put16(f.name.length)
    put16(0) // extra
    put16(0) // comment
    put16(0) // disk
    put16(0) // internal attrs
    put32(0) // external attrs
    put32(f.offset)
    putBytes(f.name)
  }

  put32(0x06054b50)
  put16(0) // this disk
  put16(0) // disk with the directory
  put16(files.length) // entries on this disk
  put16(files.length) // entries in total
  put32(central) // directory size
  put32(dirStart) // directory offset
  put16(0) // no comment
  return out
}

/**
 * The ค่า Simulate table as an .xlsx file: one row per year the table is currently showing, carrying
 * whatever is already typed in. A blank table gives a blank form; a filled one gives a backup to edit
 * in Excel and bring straight back through "นำเข้าไฟล์".
 */
export function supplierWorkbook(
  plantName: string,
  startYear: number,
  years: SupplierYear[],
  rowCount: number,
): Uint8Array<ArrayBuffer> {
  return zipStored([
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: workbookXml(plantName) },
    { name: 'xl/_rels/workbook.xml.rels', text: WORKBOOK_RELS },
    { name: 'xl/styles.xml', text: STYLES },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml(startYear, years, rowCount) },
  ])
}

// Exposed for unit tests: the one rule here that Excel refuses to open a file over.
export const _internal = { sheetName }

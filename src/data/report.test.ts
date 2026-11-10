import { describe, expect, it } from 'vitest'
import { toMonthly } from './aggregate'
import { CsvError } from './csv'
import { parsePlantReport, plantNameFromReport } from './report'
import { _internal, readXlsxGrid } from './xlsx'

// A grid shaped like the portal's monthly "Plant Report": a title row, a header row, then one row
// per month. Column order matches a real export (and deliberately includes the look-alike columns
// — Self-consumption, Loss Due to Export Limitation — that must NOT be mistaken for the real ones).
const HEADER = [
  'Statistical Period', // A
  'Total String Capacity (kWp)', // B
  'Global Irradiation (kWh/㎡)', // C
  'Sun Hours (H)', // D
  'Average Temperature(°C)', // E
  'Theoretical Yield (kWh)', // F
  'PV Yield (kWh)', // G  → produced
  'Inverter Yield (kWh)', // H
  'Export (kWh)', // I  → exported
  'Import (kWh)', // J  → imported
  'Specific Energy (kWh/kWp)', // K
  'Loss Due to Export Limitation (kWh)', // L
  'Loss Due to Export Limitation(฿)', // M
  'Consumption (kWh)', // N  → consumed
  'Self-consumption (kWh)', // O  (look-alike — must be ignored)
  'Self-consumption Rate (%)', // P
  'Peak Power (kW)', // Q  → peakKw
  'Performance Ratio(%)', // R
]

const row = (period: string, pv: number, exp: number, imp: number, consumption: number, peak: number): string[] => [
  period, '82.08', '58', '175', '0', '2725', String(pv), String(pv), String(exp), String(imp),
  '93', '', '', String(consumption), String(pv), '100', String(peak), '100',
]

const grid = (): string[][] => [
  ['Plant Report_SC Asset Corporation - SC Tower (0.08208 MWp)'],
  HEADER,
  row('2022-10', 7646.92, 0, 113045.69, 120692.61, 79.794),
  row('2022-11', 7812.59, 0, 139530.59, 147343.18, 74.109),
  row('2022-12', 9299.51, 0, 128618.74, 137918.25, 75.273),
]

describe('parsePlantReport (monthly Excel Plant Report)', () => {
  it('maps each month to one DailyRow dated to the 1st, picking the right columns', () => {
    const r = parsePlantReport(grid(), 'Plant Report - SC Tower 2022.xlsx')
    expect(r.id).toBe('SC Tower')
    expect(r.months).toBe(3)
    expect(r.skipped).toBe(0)
    expect(r.daily[0]).toEqual({
      date: '2022-10-01',
      produced: 7646.92,
      consumed: 120692.61, // "Consumption", not "Self-consumption"
      exported: 0,
      imported: 113045.69,
      peakKw: 79.794,
      samples: 31, // days in October
    })
    expect(r.daily.map((d) => d.date)).toEqual(['2022-10-01', '2022-11-01', '2022-12-01'])
  })

  it('does not mistake Self-consumption or Loss-Due-to-Export-Limitation for the real columns', () => {
    const r = parsePlantReport(grid(), 'x.xlsx')
    // Self-consumption equals PV here; if it had been chosen, consumed would be 7646.92 not 120692.61
    expect(r.daily[0].consumed).toBe(120692.61)
    expect(r.daily[0].exported).toBe(0) // the ฿/kWh loss-limitation columns are blank, not picked
  })

  it('rolls up to the exact reported monthly figures via toMonthly', () => {
    const r = parsePlantReport(grid(), 'x.xlsx')
    const months = toMonthly(r.daily)
    expect(months.map((m) => [m.key, m.produced])).toEqual([
      ['2022-10', 7646.92],
      ['2022-11', 7812.59],
      ['2022-12', 9299.51],
    ])
    expect(months[0].days).toBe(1) // one row per month
  })

  it('finds the header even with extra rows above, and counts junk rows as skipped', () => {
    const g = [['note'], [''], HEADER, row('2023-01', 100, 0, 0, 100, 10), ['', 'orphan', '5']]
    const r = parsePlantReport(g, 'x.xlsx')
    expect(r.months).toBe(1)
    expect(r.skipped).toBe(1) // the trailing row has cells but no YYYY-MM period
  })

  it('throws a Thai CsvError when there is no header or no PV-yield column', () => {
    expect(() => parsePlantReport([['just'], ['numbers', '1', '2']], 'x.xlsx')).toThrow(CsvError)
    const noPv = [['Statistical Period', 'Consumption (kWh)'], ['2023-01', '5']]
    expect(() => parsePlantReport(noPv, 'x.xlsx')).toThrow(CsvError)
  })

  it('derives a clean plant name from the report file name', () => {
    expect(plantNameFromReport('Plant Report - SC Tower 2024.xlsx')).toBe('SC Tower')
    expect(plantNameFromReport('Plant Report_บ้านรามอินทรา_2025.xlsx')).toBe('บ้านรามอินทรา')
    expect(plantNameFromReport('2026.xlsx')).toBe('Plant') // nothing left → fallback
  })
})

describe('parsePlantReport energy-unit detection', () => {
  it('converts MWh energy columns to kWh, leaving Peak Power (kW) untouched', () => {
    const g = [
      ['Statistical Period', 'PV Yield (MWh)', 'Consumption (MWh)', 'Peak Power (kW)'],
      ['2026-01', '12.5', '3.2', '80'],
    ]
    const d = parsePlantReport(g, 'x.xlsx').daily[0]
    expect(d.produced).toBe(12500) // 12.5 MWh → 12,500 kWh
    expect(d.consumed).toBe(3200)
    expect(d.peakKw).toBe(80) // kW is not an energy unit — passed through as-is
  })

  it('converts plain Wh energy columns to kWh', () => {
    const g = [['Statistical Period', 'PV Yield (Wh)'], ['2026-01', '1250000']]
    expect(parsePlantReport(g, 'x.xlsx').daily[0].produced).toBeCloseTo(1250, 6) // 1,250,000 Wh → 1,250 kWh
  })

  it('defaults an unlabelled energy column to kWh (NOT Wh like interval CSVs)', () => {
    const g = [['Statistical Period', 'PV Yield'], ['2026-01', '1250']]
    expect(parsePlantReport(g, 'x.xlsx').daily[0].produced).toBe(1250) // ×1, so monthly reports read as-is
  })

  it('reads kWh columns unchanged (the portal Plant Report default)', () => {
    const g = [['Statistical Period', 'PV Yield (kWh)'], ['2026-01', '1250']]
    expect(parsePlantReport(g, 'x.xlsx').daily[0].produced).toBe(1250) // "kWh" must not be read as "Wh"
  })
})

describe('xlsx grid extraction (XML level)', () => {
  it('column letters → zero-based index', () => {
    expect(_internal.colIndex('A1')).toBe(0)
    expect(_internal.colIndex('B4')).toBe(1)
    expect(_internal.colIndex('Z9')).toBe(25)
    expect(_internal.colIndex('AA1')).toBe(26)
  })

  it('resolves shared strings, inline strings and numbers, placing sparse cells by column', () => {
    const shared = _internal.parseSharedStrings(
      '<sst><si><t>Statistical Period</t></si><si><t>PV Yield (kWh)</t></si></sst>',
    )
    expect(shared).toEqual(['Statistical Period', 'PV Yield (kWh)'])
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>2022-10</t></is></c><c r="C2" t="n"><v>7646.92</v></c></row>' +
      '</sheetData></worksheet>'
    const rows = _internal.parseSheet(sheet, shared)
    expect(rows[0]).toEqual(['Statistical Period', 'PV Yield (kWh)'])
    expect(rows[1]).toEqual(['2022-10', '', '7646.92']) // B2 absent → '' keeps C2 in column index 2
  })

  it('unescapes XML entities in cell text', () => {
    expect(_internal.unescapeXml('A &amp; B &lt;x&gt; &#176;C')).toBe('A & B <x> °C')
  })
})

// End-to-end against a real .xlsx (unzip + parse) only when a sample report is present locally.
// Real customer reports are gitignored, so this is skipped in CI and just a local smoke test.
describe('readXlsxGrid end-to-end', () => {
  const fsName: string = 'node:fs'
  it('reads a real monthly report if one is available locally', async () => {
    const fs = await import(/* @vite-ignore */ fsName)
    const dir = new URL('../../ข้อมูล/SC Tower/', import.meta.url)
    const file = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((f: string) => f.toLowerCase().endsWith('.xlsx'))
    if (!file) return // no local sample → nothing to assert
    const buf = fs.readFileSync(new URL(file, dir))
    const grid = await readXlsxGrid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const r = parsePlantReport(grid, file)
    expect(r.months).toBeGreaterThan(0)
    expect(r.daily.every((d) => /^\d{4}-\d{2}-01$/.test(d.date))).toBe(true)
    expect(r.daily.every((d) => Number.isFinite(d.produced))).toBe(true)
  })
})

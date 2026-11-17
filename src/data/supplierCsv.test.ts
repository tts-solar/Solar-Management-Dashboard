import { describe, expect, it } from 'vitest'
import { csvToGrid } from './csv'
import { isSupplierGrid, parseSupplierGrid } from './supplierCsv'
import { _internal, supplierWorkbook } from './supplierXlsx'
import { readXlsxGrid } from './xlsx'
import type { SupplierYear } from './settings'

const y = (peakRate: number, peakKwh: number, offRate: number, offKwh: number): SupplierYear => ({
  peakRate,
  peakKwh,
  offRate,
  offKwh,
})
const grid = (csv: string): string[][] => csvToGrid(csv)
/** The downloaded workbook, read back through the same reader the import button uses. */
const written = (startYear: number, years: SupplierYear[], rowCount: number): Promise<string[][]> => {
  const bytes = supplierWorkbook('MH', startYear, years, rowCount)
  return readXlsxGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

describe('supplier sheet', () => {
  const years = [y(4.313, 17248, 2.622, 7934), y(4.399, 17151, 2.674, 7890)]

  it('round-trips the table through the workbook it writes', async () => {
    const parsed = parseSupplierGrid(await written(2024, years, 2), 2024)
    expect(parsed.years).toEqual(years)
    expect(parsed.filled).toBe(2)
    expect(parsed.skipped).toBe(0)
  })

  it('writes as many rows as the table is showing, blank where nothing is typed', async () => {
    const rows = await written(2024, years, 4)
    expect(rows).toHaveLength(5) // header + 4 years
    expect(rows[0][0]).toBe('ปี')
    expect(rows[1]).toEqual(['2024', '4.313', '17248', '2.622', '7934'])
    expect(rows[4][0]).toBe('2027') // a year past what is filled in is still offered to fill
    expect(rows[4].slice(1).join('')).toBe('')
  })

  it('reads columns by what their header says, not by where they sit', () => {
    // same data, columns shuffled and renamed the way a spreadsheet tends to come back
    const parsed = parseSupplierGrid(
      grid(
        [
          'Off-Peak Energy (kWh),Year,Peak Energy (Unit),Off-Peak Rate (THB/Unit),Peak Rate (THB/Unit)',
          '7934,2024,17248,2.622,4.313',
        ].join('\n'),
      ),
      2024,
    )
    expect(parsed.years).toEqual([years[0]]) // "Off-Peak Rate" must never land in the plain Peak slot
  })

  it('places a row by the year it names, and counts one outside the table rather than dropping it', () => {
    const parsed = parseSupplierGrid(
      grid(['ปี,Peak Rate,Peak Energy,Off-Peak Rate,Off-Peak Energy', '2023,9,999,9,999', '2026,4.487,17054,2.728,7845'].join('\n')),
      2024,
    )
    expect(parsed.skipped).toBe(1) // 2023 is before commissioning
    expect(parsed.years).toHaveLength(3) // 2024, 2025 blank, then 2026
    expect(parsed.years[2]).toEqual(y(4.487, 17054, 2.728, 7845))
    expect(parsed.filled).toBe(1)
  })

  it('tells a supplier sheet apart from the other files the dashboard reads', async () => {
    expect(isSupplierGrid(await written(2024, years, 2))).toBe(true)
    // a monthly Plant Report: no year column, and its periods are YYYY-MM
    expect(isSupplierGrid(grid('Statistical Period,PV Yield (kWh)\n2026-01,1250.5'))).toBe(false)
    // the header alone, with no year rows under it, is not yet a sheet worth reading
    expect(isSupplierGrid(grid('ปี,Peak Rate,Peak Energy,Off-Peak Rate,Off-Peak Energy'))).toBe(false)
  })

  it('names the sheet after the plant, within what Excel will open', () => {
    const { sheetName } = _internal
    expect(sheetName('MH')).toBe('MH · Simulate')
    expect(sheetName('บ้านตัวอย่าง')).toBe('บ้านตัวอย่าง · Simulate') // a Thai name survives whole
    // Excel refuses the file outright over any of these, so they never reach it
    expect(sheetName('A/B:C*D?E[F]')).toBe('A B C D E F · Simulate')
    expect(sheetName('  ')).toBe('Simulate') // a tab must have a name
    expect(sheetName('///')).toBe('Simulate') // …and one made only of forbidden characters has none
    const long = 'Rooftop Plant At The Far Warehouse'
    expect(sheetName(long)).toBe(long.slice(0, 31)) // the plant's own name wins over the suffix
    expect(sheetName(long).length).toBeLessThanOrEqual(31)
  })

  it('writes a peak-only table without leaving the off-peak columns out', async () => {
    const rows = await written(2024, [y(5.156, 170450, 0, 0)], 1)
    expect(rows[1]).toEqual(['2024', '5.156', '170450', '', '']) // the two off-peak cells stay in place, empty
    expect(parseSupplierGrid(rows, 2024).years).toEqual([y(5.156, 170450, 0, 0)])
  })
})

/**
 * Downloadable starter files for people who enter data by hand (plants with no portal export, or
 * backfilling history). Both are plain CSV so they open in Excel, and both round-trip through the
 * dashboard's own importer:
 *   - the monthly template is a real Plant Report CSV (one row per month) → parsePlantReport
 *   - the daily sample is an interval export (one row per reading)        → parseCsv
 * The plant's identity comes from the FILE NAME, so the UI tells the user to rename before importing.
 */

/** A monthly Plant Report as CSV: a title row, the header, then one row per month to fill in. */
export function monthlyTemplateCsv(): string {
  return [
    'Plant Report - ตัวอย่าง 2026',
    'Statistical Period,PV Yield (kWh),Consumption (kWh),Export (kWh),Import (kWh),Peak Power (kW)',
    '2026-01,1250.5,320.0,980.2,50.1,8.4',
    '2026-02,1380.0,300.5,1120.0,40.0,8.9',
    '2026-03,1520.3,340.8,1210.0,55.0,9.2',
  ].join('\r\n')
}

/** An interval (15-min style) export as CSV: header, then evenly-spaced readings across one day.
 *  Hourly here for brevity — real portal exports are usually every 15 minutes. */
export function dailyTemplateCsv(): string {
  const rows: Array<[string, number, number]> = [
    ['06:00', 0.0, 0.2], ['07:00', 0.5, 0.3], ['08:00', 1.2, 0.3], ['09:00', 2.1, 0.4],
    ['10:00', 2.9, 0.4], ['11:00', 3.3, 0.5], ['12:00', 3.4, 0.5], ['13:00', 3.2, 0.5],
    ['14:00', 2.6, 0.4], ['15:00', 2.0, 0.4], ['16:00', 1.1, 0.4], ['17:00', 0.3, 0.6],
    ['18:00', 0.0, 0.6],
  ]
  const lines = ['Date/Time,Energy Produced (kWh),Energy Consumed (kWh),Exported to Grid (kWh),Imported from Grid (kWh)']
  for (const [time, prod, cons] of rows) {
    const exported = Math.max(0, prod - cons)
    const imported = Math.max(0, cons - prod)
    lines.push(`2026-01-01 ${time},${prod.toFixed(2)},${cons.toFixed(2)},${exported.toFixed(2)},${imported.toFixed(2)}`)
  }
  return lines.join('\r\n')
}

/** Offer a generated CSV as a file download (BOM so Excel reads Thai correctly). */
function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadMonthlyTemplate(): void {
  downloadCsv('Plant Report - ตัวอย่าง 2026.csv', monthlyTemplateCsv())
}

export function downloadDailyTemplate(): void {
  downloadCsv('ตัวอย่าง_รายวัน.csv', dailyTemplateCsv())
}

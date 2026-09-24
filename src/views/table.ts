import { fmt0, fmt1, pct } from '../charts/common'

/** "Data table" tab: one row per month (year view) or per day (month view), with a total row. */

export interface TableRow {
  key: string
  label: string
  consumed: number
  produced: number
  efficiency: number | null
  abnormal: boolean
}

export interface TableTotal {
  consumed: number
  produced: number
  efficiency: number | null
}

export function dataTable(rows: TableRow[], total: TableTotal, daily: boolean, onRow?: (key: string) => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'table-wrap'
  const table = document.createElement('table')
  table.className = 'data'
  const kwh = daily ? fmt1 : fmt0 // days are small numbers, keep one decimal like the slide

  const cell = (tr: HTMLTableRowElement, text: string, tag: 'td' | 'th' = 'td', cls = '') => {
    const c = document.createElement(tag)
    c.textContent = text
    if (cls) c.className = cls
    tr.append(c)
  }

  const head = table.createTHead().insertRow()
  for (const h of ['NO', 'Date', 'Consume (kWh)', 'Produce (kWh)', '% Efficiency']) cell(head, h, 'th')

  const body = table.createTBody()
  rows.forEach((r, i) => {
    const tr = body.insertRow()
    cell(tr, String(i + 1))
    cell(tr, r.label)
    cell(tr, fmt0(r.consumed), 'td', 'num')
    cell(tr, kwh(r.produced), 'td', 'num')
    cell(tr, pct(r.efficiency, 0), 'td', r.abnormal ? 'num bad' : 'num')
    if (onRow) {
      tr.className = 'link'
      tr.tabIndex = 0
      tr.title = `ดูรายวันของ ${r.label}`
      tr.addEventListener('click', () => onRow(r.key))
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onRow(r.key)
        }
      })
    }
  })

  const foot = table.createTFoot().insertRow()
  cell(foot, '')
  cell(foot, 'รวม')
  cell(foot, fmt0(total.consumed), 'td', 'num')
  cell(foot, kwh(total.produced), 'td', 'num')
  cell(foot, pct(total.efficiency, 0), 'td', 'num')

  wrap.append(table)
  return wrap
}

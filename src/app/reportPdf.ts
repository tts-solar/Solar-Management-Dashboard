import type { Plant } from '../data/types'
import { monthOf, yearOf } from '../data/aggregate'
import { MONTHS } from '../charts/common'

/**
 * Report PDF: a presentation snapshot of the REAL dashboard (not the Export savings table). The user
 * picks plant(s), whether to include the Overview page, and a year (+ optional month); each selection
 * is rendered with the actual dashboard charts into a print overlay, one page each. The browser's own
 * Print → "Save as PDF" turns it into a document.
 *
 * Why render the live views (no html2canvas / screenshot lib): the CSP network-lock + singlefile build
 * forbid external scripts, and every chart already runs with `animation: false`, so a plain
 * `window.print()` of the on-screen charts prints cleanly. @media print hides the app and shows only
 * this overlay (reusing the Export report's print rules), one page per break.
 */

export interface ReportPdfOpts {
  plants: Plant[]
  displayName(p: Plant): string
  /** Render the Overview dashboard (real charts) into `el` for the given year. */
  renderOverview(el: HTMLElement, year: string): void
  /** Render one plant's dashboard (real charts) into `el` for the given year (+ optional 'MM' month). */
  renderPlant(el: HTMLElement, plant: Plant, year: string, month?: string): void
  /** Called once the overlay is closed, so the caller can free the print charts + restore the live view. */
  onDone(): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Distinct years present across all plants, newest first. */
function allYears(plants: Plant[]): string[] {
  const set = new Set<string>()
  for (const p of plants) for (const d of p.daily) set.add(yearOf(d.date))
  return [...set].sort().reverse()
}

/** 'MM' months present in the given year across all plants, ascending. */
function monthsInYear(plants: Plant[], year: string): string[] {
  const set = new Set<string>()
  for (const p of plants) for (const d of p.daily) if (yearOf(d.date) === year) set.add(monthOf(d.date).slice(5))
  return [...set].sort()
}

/** Does this plant have any data in the given year? (skip its page otherwise — an empty view reads as 0). */
const plantHasYear = (plant: Plant, year: string): boolean => plant.daily.some((d) => yearOf(d.date) === year)

/** Build + show the print overlay: one page per selected target, real dashboard charts, then let the user print. */
function openPrintOverlay(
  o: ReportPdfOpts,
  targets: { title: string; render(box: HTMLElement): void }[],
): void {
  const overlay = el('div', 'report-overlay')

  const toolbar = el('div', 'report-toolbar')
  const title = el('span', 'report-tb-title', 'รายงานพร้อมพิมพ์ — กด "พิมพ์ / บันทึก PDF" แล้วเลือกปลายทางเป็น PDF')
  const printBtn = el('button', 'c-btn primary', 'พิมพ์ / บันทึก PDF')
  printBtn.type = 'button'
  const closeBtn = el('button', 'c-btn ghost', 'ปิด')
  closeBtn.type = 'button'
  toolbar.append(title, printBtn, closeBtn)

  const doc = el('div', 'report-doc')
  // Render each page's real charts into its content box. The overlay is already full-screen and visible,
  // so each box has a real width when the charts mount (Chart.js reads layout at creation time).
  for (const t of targets) {
    const page = el('section', 'pdf-page')
    page.append(el('h2', 'pdf-page-title', t.title))
    const content = el('div', 'pdf-page-body')
    page.append(content)
    doc.append(page)
    t.render(content)
  }

  overlay.append(toolbar, doc)
  document.body.append(overlay)

  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
    o.onDone() // free the print charts + restore the live dashboard
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  printBtn.addEventListener('click', () => window.print())
  closeBtn.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  printBtn.focus()
}

/** Open the Report PDF dialog: pick plants + Overview + year/month, then snapshot the dashboard to print. */
export function openReportPdf(o: ReportPdfOpts): void {
  const dlg = el('dialog', 'export-dlg')
  dlg.setAttribute('aria-label', 'สร้าง Report PDF')

  const head = el('div', 'exp-head')
  head.append(
    el('h2', '', 'สร้าง Report PDF'),
    el('p', 'exp-sub', 'เลือก Plant, หน้า Overview, ปีและเดือน แล้วสร้างรายงานภาพรวม (กราฟจริงจาก Dashboard) สำหรับพิมพ์เป็น PDF'),
  )

  // plant checklist (all selected by default)
  const plantBox = el('div', 'exp-plants')
  plantBox.append(el('span', 'exp-label', 'Plant'))
  const boxes: { plant: Plant; input: HTMLInputElement }[] = []
  for (const p of o.plants) {
    const row = el('label', 'exp-check')
    const input = el('input')
    input.type = 'checkbox'
    input.checked = true
    row.append(input, el('span', '', o.displayName(p)))
    plantBox.append(row)
    boxes.push({ plant: p, input })
  }

  // include-Overview toggle (its own line, on by default)
  const ovBox = el('div', 'exp-plants')
  ovBox.append(el('span', 'exp-label', 'หน้าอื่น'))
  const ovRow = el('label', 'exp-check')
  const ovInput = el('input')
  ovInput.type = 'checkbox'
  ovInput.checked = true
  ovRow.append(ovInput, el('span', '', 'รวมหน้า Overview'))
  ovBox.append(ovRow)

  // year + month selectors (month options follow the chosen year)
  const years = allYears(o.plants)
  const yearBox = el('div', 'exp-year')
  yearBox.append(el('span', 'exp-label', 'ปี'))
  const yearSel = el('select', 'exp-select')
  for (const y of years) {
    const opt = el('option', '', y)
    opt.value = y
    yearSel.append(opt)
  }
  yearBox.append(yearSel)

  const monthBox = el('div', 'exp-year')
  monthBox.append(el('span', 'exp-label', 'เดือน'))
  const monthSel = el('select', 'exp-select')
  monthBox.append(monthSel)
  const fillMonths = (): void => {
    monthSel.replaceChildren()
    const all = el('option', '', 'ทั้งปี')
    all.value = ''
    monthSel.append(all)
    for (const m of monthsInYear(o.plants, yearSel.value)) {
      const opt = el('option', '', MONTHS[+m - 1])
      opt.value = m
      monthSel.append(opt)
    }
    monthSel.value = ''
  }
  fillMonths()
  yearSel.addEventListener('change', fillMonths) // new year → its own months, reset to ทั้งปี

  const actions = el('div', 'confirm-actions')
  const cancel = el('button', 'c-btn ghost', 'ยกเลิก')
  cancel.type = 'button'
  const make = el('button', 'c-btn primary', 'สร้าง Report')
  make.type = 'button'
  actions.append(cancel, make)

  // shown when the selection yields no page to print (no plant ticked + Overview off, or no data that year)
  const err = el('p', 'exp-err', 'เลือกอย่างน้อย 1 หน้า (Plant หรือ Overview) ที่มีข้อมูลในปีที่เลือก')
  err.hidden = true
  const clearErr = (): void => void (err.hidden = true)
  plantBox.addEventListener('change', clearErr)
  ovBox.addEventListener('change', clearErr)
  yearSel.addEventListener('change', clearErr)

  dlg.append(head, plantBox, ovBox, yearBox, monthBox, err, actions)
  document.body.append(dlg)

  const close = (): void => {
    if (dlg.open) dlg.close()
    dlg.remove()
  }
  cancel.addEventListener('click', close)
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close()
  })
  make.addEventListener('click', () => {
    const year = yearSel.value
    const month = monthSel.value || undefined
    const monthLabel = month ? ` · ${MONTHS[+month - 1]}` : ''
    const targets: { title: string; render(box: HTMLElement): void }[] = []
    if (ovInput.checked && years.length) {
      targets.push({ title: `Overview · ปี ${year}`, render: (box) => o.renderOverview(box, year) })
    }
    for (const b of boxes) {
      if (!b.input.checked) continue
      if (!plantHasYear(b.plant, year)) continue // skip a plant with nothing recorded that year
      const name = o.displayName(b.plant)
      targets.push({
        title: `${name} · ปี ${year}${monthLabel}`,
        render: (box) => o.renderPlant(box, b.plant, year, month),
      })
    }
    if (!targets.length) {
      err.hidden = false
      return
    }
    close()
    openPrintOverlay(o, targets)
  })

  dlg.showModal()
  make.focus()
}

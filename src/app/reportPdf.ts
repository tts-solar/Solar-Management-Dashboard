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
 * this overlay, one page per break.
 *
 * Every page is a fixed 16:9 slide (PAGE_W × PAGE_H below) rather than whatever paper the browser
 * happens to be set to. Two things follow from that and they are the reason this file touches layout
 * at all: the overlay shows the real printed rectangle, and `fitToPage` scales each page's content into
 * it, so nothing can run off the edge or collide the way a browser-paginated page would.
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

/**
 * The printed page box, in CSS px at 96dpi: 1280×720 = 13.333in × 7.5in — the standard 16:9 widescreen
 * slide. `.pdf-page` in styles.css is pinned to exactly these numbers, so the box on screen and the
 * sheet of paper are the same rectangle and nothing is reflowed at print time. Change both together.
 */
const PAGE_W = 1280
const PAGE_H = 720

/**
 * Scale one page's content until it fits the page box, and fit it to the WIDTH while doing so.
 *
 * The dashboard is a responsive grid, so simply shrinking it would leave a tall, narrow block floating
 * in a wide 16:9 page. Instead the content is laid out at `boxWidth / k` — wider than the box — and
 * scaled back down by `k`: the grid reflows into the landscape shape first, then shrinks only as much
 * as it still has to. A wider layout is a shorter one, which in turn allows a larger `k`, so the two
 * chase each other; the loop converges in two or three rounds and the last pass re-measures at the
 * final width, which is what guarantees the result really fits rather than merely nearly fits.
 */
function fitToPage(box: HTMLElement, content: HTMLElement): void {
  const w = box.clientWidth
  const h = box.clientHeight
  if (!w || !h) return
  let k = 1
  for (let i = 0; i < 4; i++) {
    content.style.transform = 'none'
    content.style.width = `${w / k}px`
    // the floor is a safety valve, not a target: shrinking past it would be unreadable anyway, and a
    // page that needs it is a layout bug — but scaling too far still beats silently clipping content
    const next = Math.max(0.3, Math.min(1, h / content.scrollHeight))
    const settled = Math.abs(next - k) < 0.01
    k = next
    if (settled) break
  }
  // measure once more at the width we are actually keeping, so `k` is the honest fit for this layout
  content.style.transform = 'none'
  content.style.width = `${w / k}px`
  k = Math.min(k, h / content.scrollHeight)
  content.style.transform = k < 1 ? `scale(${k})` : 'none'
}

/** Build + show the print overlay: one page per selected target, real dashboard charts, then let the user print. */
function openPrintOverlay(
  o: ReportPdfOpts,
  targets: { title: string; render(box: HTMLElement): void }[],
): void {
  const overlay = el('div', 'report-overlay')

  // `@page` cannot be scoped by a selector, so the 16:9 paper size lives with the overlay and leaves
  // with it — a plain Ctrl+P of the dashboard keeps whatever paper the browser is set to.
  const paper = el('style')
  paper.textContent = `@page { size: ${PAGE_W / 96}in ${PAGE_H / 96}in; margin: 0 }`
  document.head.append(paper)

  const toolbar = el('div', 'report-toolbar')
  const title = el(
    'span',
    'report-tb-title',
    'รายงาน 16:9 พร้อมพิมพ์ — ในกล่องพิมพ์ เลือกปลายทาง "บันทึกเป็น PDF" และปิด "ส่วนหัวและส่วนท้าย"',
  )
  const printBtn = el('button', 'c-btn primary', 'พิมพ์ / บันทึก PDF')
  printBtn.type = 'button'
  const closeBtn = el('button', 'c-btn ghost', 'ปิด')
  closeBtn.type = 'button'
  toolbar.append(title, printBtn, closeBtn)

  const doc = el('div', 'report-doc')
  // Render each page's real charts into its own scaling layer. The charts mount while the tree is still
  // detached, so they start at zero width and catch up once it is attached — harmless, because every
  // chart sits in a fixed-height `.chart-box`: the page's layout height does not wait on them, and
  // fitToPage can measure as soon as the overlay is in the document.
  const pages: { box: HTMLElement; content: HTMLElement }[] = []
  for (const t of targets) {
    const page = el('section', 'pdf-page')
    page.append(el('h2', 'pdf-page-title', t.title))
    const box = el('div', 'pdf-page-body')
    const content = el('div', 'pdf-page-fit')
    box.append(content)
    page.append(box)
    doc.append(page)
    pages.push({ box, content })
    t.render(content)
  }

  overlay.append(toolbar, doc)
  document.body.append(overlay)

  // A page is a fixed 1280px wide, which is more than some windows have: shrink the whole stack to fit
  // so the preview never needs a horizontal scrollbar. Print ignores --doc-zoom (see styles.css).
  const fitDoc = (): void => {
    doc.style.setProperty('--doc-zoom', String(Math.min(1, (overlay.clientWidth - 32) / PAGE_W)))
  }
  const fitAll = (): void => {
    fitDoc()
    for (const p of pages) fitToPage(p.box, p.content)
  }
  fitAll()
  // again after a frame: webfont metrics and the charts' first resize can both move the natural height
  requestAnimationFrame(fitAll)
  window.addEventListener('resize', fitAll)
  window.addEventListener('beforeprint', fitAll) // last word before the layout is committed to paper

  const close = (): void => {
    overlay.remove()
    paper.remove() // give the browser's own paper setting back to the rest of the app
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', fitAll)
    window.removeEventListener('beforeprint', fitAll)
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

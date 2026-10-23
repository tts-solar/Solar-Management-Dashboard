import type { DailyRow, DayProfile } from '../data/types'
import type { Resolved } from '../data/metrics'
import { advisorSection } from '../views/advisor'

/**
 * Solar vs Energy Storage advisor as a modal. The advisor used to sit at the bottom of the Plant
 * view; it now opens from the "Plant Age (Year)" KPI card so the investment question is one click
 * away without crowding the dashboard. The body is the SAME `advisorSection` element the inline
 * version rendered (analysis badge + supporting numbers + What-if), so the tested compute and the
 * two-part layout are reused unchanged — only the container is a `<dialog>`.
 *
 * No external libs (CSP network-lock + singlefile build); the close pattern mirrors reportPdf.ts
 * (Esc / backdrop click / ✕ button).
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Open the advisor popup for one plant/period. `daily` is the days currently on screen. */
export function openAdvisorDialog(daily: DailyRow[], r: Resolved, profile?: DayProfile): void {
  const dlg = el('dialog', 'advisor-dlg')
  dlg.setAttribute('aria-label', 'ตัวช่วยตัดสินใจลงทุนเพิ่ม Solar vs Energy Storage')

  const closeBtn = el('button', 'advisor-dlg-close', '✕')
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', 'ปิด')

  const body = advisorSection(daily, r, profile) // analysis + What-if, same as the old inline block

  dlg.append(closeBtn, body)
  document.body.append(dlg)

  const close = (): void => {
    if (dlg.open) dlg.close()
    dlg.remove()
  }
  closeBtn.addEventListener('click', close)
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault() // Esc → our close() (so the node is removed, not just hidden)
    close()
  })
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close() // click on the backdrop (the dialog's own padding) closes
  })

  dlg.showModal()
  closeBtn.focus()
}

import type { DailyRow, Plant } from '../data/types'
import { monthOf, yearOf } from '../data/aggregate'
import { resolve, simulatePerDayOn } from '../data/metrics'
import { settingsFor, tariffForDate, type PlantSettings, type SettingsMap } from '../data/settings'
import { baht, fmt0, MONTHS } from '../charts/common'

/**
 * Export-to-Template: a per-plant savings report that mirrors the Greenergy_Saving layout
 * (header block + period table + saving bar chart), but fed with REAL data at a user-chosen
 * granularity. Unlike the source doc (a flat 25-year forecast), our rows are the actual data
 * periods — by year or by month (the H1/H2 tariff split still applies at the day level), and can
 * be narrowed to a single calendar year — so the numbers are real.
 *
 * Output = an in-page print overlay: the browser's own Print → "Save as PDF" turns it into a
 * document. Rendered inside the app (never a popup) so the CSP network-lock and scripts are intact;
 * @media print hides the dashboard and shows only the report, one plant per page.
 */

export type Granularity = 'year' | 'month'

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  year: 'รายปี',
  month: 'รายเดือน',
}

/** One row of the report table — a data period summarised from the plant's real daily rows. */
export interface ReportRow {
  key: string
  label: string
  produced: number
  consumed: number
  imported: number
  days: number
  /** Σ over the period's days of produced × that month's tariff (H1/H2 aware). */
  saving: number
  /** supplier's claimed kWh for the period = Σ simulatePerDayOn over the days (per-year claim, formula fallback). */
  simulate: number
  /** (produced − simulate) ÷ simulate — how far real output runs over/under the claim; null when nothing to compare. */
  diff: number | null
  /** effective price actually applied = saving ÷ produced (฿/kWh). */
  effTariff: number | null
}

/** Which bucket a date falls in under the chosen granularity. */
function bucketKey(date: string, g: Granularity): string {
  return g === 'year' ? yearOf(date) : monthOf(date)
}

/** Human label for a bucket key (English month to match the rest of the app). */
function bucketLabel(key: string, g: Granularity): string {
  if (g === 'year') return key
  const [y, m] = key.split('-')
  return `${MONTHS[+m - 1]} ${y}`
}

/** Daily rows limited to one calendar year, or all of them when no year is given. */
function dailyInYear(plant: Plant, year?: string): DailyRow[] {
  return year ? plant.daily.filter((d) => yearOf(d.date) === year) : plant.daily
}

/** Every calendar year present across the given plants' data, newest first. */
export function yearsOf(plants: Plant[]): string[] {
  const set = new Set<string>()
  for (const p of plants) for (const d of p.daily) set.add(yearOf(d.date))
  return [...set].sort().reverse()
}

/** Summarise one plant's real daily data into report rows, in period order. */
export function reportRows(plant: Plant, s: PlantSettings, g: Granularity, year?: string): ReportRow[] {
  const r = resolve(plant, s)
  const startYear = +r.startDate.slice(0, 4)
  const buckets = new Map<string, DailyRow[]>()
  for (const d of dailyInYear(plant, year)) {
    const k = bucketKey(d.date, g)
    const arr = buckets.get(k)
    if (arr) arr.push(d)
    else buckets.set(k, [d])
  }
  const rows: ReportRow[] = []
  for (const [key, days] of buckets) {
    let produced = 0
    let consumed = 0
    let imported = 0
    let saving = 0
    let simulate = 0
    for (const d of days) {
      produced += d.produced
      consumed += d.consumed
      imported += d.imported
      saving += d.produced * tariffForDate(r, d.date, startYear)
      simulate += simulatePerDayOn(r, d.date) // the supplier's claimed kWh for that day's project-year
    }
    rows.push({
      key,
      label: bucketLabel(key, g),
      produced,
      consumed,
      imported,
      days: days.length,
      saving,
      simulate,
      diff: simulate > 0 ? (produced - simulate) / simulate : null,
      effTariff: produced > 0 ? saving / produced : null,
    })
  }
  return rows
}

interface ReportTotals {
  produced: number
  saving: number
  imported: number
  simulate: number
  days: number
}

function totalsOf(rows: ReportRow[]): ReportTotals {
  return rows.reduce<ReportTotals>(
    (t, r) => ({
      produced: t.produced + r.produced,
      saving: t.saving + r.saving,
      imported: t.imported + r.imported,
      simulate: t.simulate + r.simulate,
      days: t.days + r.days,
    }),
    { produced: 0, saving: 0, imported: 0, simulate: 0, days: 0 },
  )
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** A signed "ต่าง (%)" cell — green when real output beats the supplier's claim, red when it falls short. */
function diffCell(d: number | null): string {
  if (d === null) return '<td>–</td>'
  const sign = d >= 0 ? '+' : '−'
  const color = d >= 0 ? '#17594a' : '#b00020' // same green as the bars / a plain red
  return `<td style="color:${color}">${sign}${(Math.abs(d) * 100).toFixed(1)}%</td>`
}

/** A hand-drawn inline SVG bar chart (saving per period) — no Chart.js, so it prints reliably. */
function svgBars(rows: ReportRow[]): string {
  if (!rows.length) return ''
  const W = Math.max(520, rows.length * 32 + 70)
  const H = 240
  const pad = { l: 64, r: 14, t: 16, b: 60 }
  const plotH = H - pad.t - pad.b
  const plotW = W - pad.l - pad.r
  const max = Math.max(...rows.map((r) => r.saving), 1)
  const bw = plotW / rows.length
  const baseY = pad.t + plotH
  const bars = rows
    .map((r, i) => {
      const h = (r.saving / max) * plotH
      const x = pad.l + i * bw + bw * 0.15
      const y = baseY - h
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="#17594a"/>`
    })
    .join('')
  const labels = rows
    .map((r, i) => {
      const x = pad.l + i * bw + bw / 2
      const ly = baseY + 12
      return `<text x="${x.toFixed(1)}" y="${ly}" font-size="9" fill="#111" text-anchor="end" transform="rotate(-45 ${x.toFixed(1)} ${ly})">${esc(r.label)}</text>`
    })
    .join('')
  const axis = `<line x1="${pad.l}" y1="${baseY}" x2="${W - pad.r}" y2="${baseY}" stroke="#595959"/>`
  const yMax = `<text x="6" y="${pad.t + 8}" font-size="9" fill="#595959">${esc(baht(max))}</text>`
  const yZero = `<text x="6" y="${baseY}" font-size="9" fill="#595959">0</text>`
  return `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="กราฟเงินที่ประหยัดต่อช่วงเวลา">${axis}${bars}${labels}${yMax}${yZero}</svg>`
}

/**
 * A hand-drawn grouped-bar chart: per period, the real production bar beside the supplier's claim bar
 * (kWh), so over/under-performance is visible at a glance. Inline SVG — no Chart.js, so it prints.
 */
function svgCompareBars(rows: ReportRow[]): string {
  if (!rows.length) return ''
  const W = Math.max(520, rows.length * 56 + 70)
  const H = 260
  const pad = { l: 64, r: 14, t: 30, b: 60 }
  const plotH = H - pad.t - pad.b
  const plotW = W - pad.l - pad.r
  const max = Math.max(...rows.flatMap((r) => [r.produced, r.simulate]), 1)
  const groupW = plotW / rows.length
  const bw = groupW * 0.3 // two bars per group, side by side around the group centre
  const baseY = pad.t + plotH
  const COLOR = { produced: '#17594a', claim: '#2f6f9f' } // green = real, blue = the supplier's claim
  const bar = (x: number, v: number, fill: string): string => {
    const h = (v / max) * plotH
    return `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`
  }
  const bars = rows
    .map((r, i) => {
      const cx = pad.l + i * groupW + groupW / 2
      return bar(cx - bw - 2, r.produced, COLOR.produced) + bar(cx + 2, r.simulate, COLOR.claim)
    })
    .join('')
  const labels = rows
    .map((r, i) => {
      const x = pad.l + i * groupW + groupW / 2
      const ly = baseY + 12
      return `<text x="${x.toFixed(1)}" y="${ly}" font-size="9" fill="#111" text-anchor="end" transform="rotate(-45 ${x.toFixed(1)} ${ly})">${esc(r.label)}</text>`
    })
    .join('')
  const axis = `<line x1="${pad.l}" y1="${baseY}" x2="${W - pad.r}" y2="${baseY}" stroke="#595959"/>`
  const yMax = `<text x="6" y="${pad.t + 8}" font-size="9" fill="#595959">${esc(fmt0(max))}</text>`
  const yZero = `<text x="6" y="${baseY}" font-size="9" fill="#595959">0</text>`
  const legend =
    `<rect x="${pad.l}" y="8" width="11" height="11" fill="${COLOR.produced}"/>` +
    `<text x="${pad.l + 16}" y="17" font-size="10" fill="#111">ผลิตจริง (kWh)</text>` +
    `<rect x="${pad.l + 118}" y="8" width="11" height="11" fill="${COLOR.claim}"/>` +
    `<text x="${pad.l + 134}" y="17" font-size="10" fill="#111">ผู้ขายเคลม (kWh)</text>`
  return `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="กราฟเทียบพลังงานผลิตจริงกับที่ผู้ขายเคลม">${axis}${legend}${bars}${labels}${yMax}${yZero}</svg>`
}

/** HTML for one plant's report page (header block + table + comparison + saving bar charts). */
function plantPage(plant: Plant, s: PlantSettings, name: string, g: Granularity, year?: string): string {
  const rows = reportRows(plant, s, g, year)
  // No data in the chosen period: show a plain notice, not the KPIs + empty table. The investment
  // KPI comes from settings (not the data), so it would otherwise show a real figure beside an empty
  // page and read as "saved ฿0 that year" when there is simply nothing recorded (M6b).
  if (!rows.length) {
    const scope = year ? `ปี ${year}` : 'ช่วงที่เลือก'
    return `
    <section class="rp-page">
      <div class="rp-head">
        <div class="rp-title">
          <h2>${esc(name)}</h2>
          <p class="rp-sub">รายงานการประหยัดค่าไฟ · ${esc(GRANULARITY_LABELS[g])}</p>
        </div>
      </div>
      <p class="rp-empty">ไม่มีข้อมูลสำหรับ${esc(scope)}</p>
    </section>`
  }
  const r = resolve(plant, s)
  const t = totalsOf(rows)
  const span = dailyInYear(plant, year)
  const years = t.days / 365.25
  const savingPerYear = years > 0 ? t.saving / years : 0
  const lastRow = rows[rows.length - 1]
  const firstDate = span[0]?.date ?? '—'
  const lastDate = span[span.length - 1]?.date ?? '—'
  const showBill = t.imported > 0

  const kpi = (label: string, value: string, note?: string): string =>
    `<div class="rp-kpi"><span class="rp-kpi-l">${esc(label)}</span><span class="rp-kpi-v">${esc(value)}</span>${note ? `<span class="rp-kpi-n">${esc(note)}</span>` : ''}</div>`

  const header = `
    <div class="rp-head">
      <div class="rp-title">
        <h2>${esc(name)}</h2>
        <p class="rp-sub">รายงานการประหยัดค่าไฟ · ${esc(GRANULARITY_LABELS[g])} · ข้อมูล ${esc(firstDate)} ถึง ${esc(lastDate)}</p>
      </div>
      <div class="rp-kpis">
        ${kpi('เงินลงทุน', r.investment > 0 ? baht(r.investment) : '—')}
        ${kpi('พลังงานผลิตรวม', `${fmt0(t.produced)} kWh`)}
        ${kpi('ประหยัดรวม', baht(t.saving))}
        ${kpi('ประหยัดเฉลี่ย/ปี', baht(savingPerYear))}
        ${kpi('ประหยัดล่าสุด', lastRow ? baht(lastRow.saving) : '—', lastRow?.label)}
      </div>
    </div>`

  const head = `
    <tr>
      <th>ช่วงเวลา</th>
      <th>ผลิตจริง (kWh)</th>
      <th>ผู้ขายเคลม (kWh)</th>
      <th>ต่าง (%)</th>
      <th>฿/kWh</th>
      ${showBill ? '<th>ค่าไฟที่ยังจ่าย (฿)</th>' : ''}
      <th>ประหยัด (฿)</th>
    </tr>`

  const body = rows
    .map(
      (row) => `
    <tr>
      <td>${esc(row.label)}</td>
      <td>${fmt0(row.produced)}</td>
      <td>${row.simulate > 0 ? fmt0(row.simulate) : '–'}</td>
      ${diffCell(row.diff)}
      <td>${row.effTariff === null ? '–' : row.effTariff.toFixed(3)}</td>
      ${showBill ? `<td>${row.imported > 0 && row.effTariff !== null ? fmt0(row.imported * row.effTariff) : '–'}</td>` : ''}
      <td>${fmt0(row.saving)}</td>
    </tr>`,
    )
    .join('')

  const totalDiff = t.simulate > 0 ? (t.produced - t.simulate) / t.simulate : null
  const foot = `
    <tr class="rp-total">
      <td>รวม</td>
      <td>${fmt0(t.produced)}</td>
      <td>${t.simulate > 0 ? fmt0(t.simulate) : '–'}</td>
      ${diffCell(totalDiff)}
      <td>–</td>
      ${showBill ? `<td>${fmt0(t.imported * (t.produced > 0 ? t.saving / t.produced : 0))}</td>` : ''}
      <td>${fmt0(t.saving)}</td>
    </tr>`

  return `
    <section class="rp-page">
      ${header}
      <table class="rp-table">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
      <div class="rp-chart-wrap">
        <h3>กราฟเทียบผลิตจริงกับที่ผู้ขายเคลม (${esc(GRANULARITY_LABELS[g])})</h3>
        ${svgCompareBars(rows)}
      </div>
      <div class="rp-chart-wrap">
        <h3>กราฟเงินที่ประหยัด (${esc(GRANULARITY_LABELS[g])})</h3>
        ${svgBars(rows)}
      </div>
    </section>`
}

/** Full report HTML for the chosen plants + granularity (one page per plant). */
export function buildReportHtml(
  plants: Plant[],
  settings: SettingsMap,
  displayName: (p: Plant) => string,
  g: Granularity,
  year?: string,
): string {
  return plants.map((p) => plantPage(p, settingsFor(settings, p.id), displayName(p), g, year)).join('')
}

// ── UI ─────────────────────────────────────────────────────────────────────

export interface ExportOpts {
  plants: Plant[]
  settings: SettingsMap
  displayName(p: Plant): string
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Render the printable report overlay and hand focus to it; the user prints from its toolbar. */
function openReportOverlay(html: string): void {
  const overlay = el('div', 'report-overlay')

  const toolbar = el('div', 'report-toolbar')
  const title = el('span', 'report-tb-title', 'รายงานพร้อมพิมพ์ — กด "พิมพ์ / บันทึก PDF" แล้วเลือกปลายทางเป็น PDF')
  const printBtn = el('button', 'c-btn primary', 'พิมพ์ / บันทึก PDF')
  printBtn.type = 'button'
  const closeBtn = el('button', 'c-btn ghost', 'ปิด')
  closeBtn.type = 'button'
  toolbar.append(title, printBtn, closeBtn)

  const doc = el('div', 'report-doc')
  doc.innerHTML = html

  overlay.append(toolbar, doc)
  document.body.append(overlay)

  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  printBtn.addEventListener('click', () => window.print())
  closeBtn.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  printBtn.focus()
}

/** Open the export dialog: pick plants + granularity, then generate the printable report. */
export function openExport(o: ExportOpts): void {
  const dlg = el('dialog', 'export-dlg')
  dlg.setAttribute('aria-label', 'ส่งออกรายงาน')

  const head = el('div', 'exp-head')
  head.append(
    el('h2', '', 'ส่งออกรายงานการประหยัด'),
    el('p', 'exp-sub', 'เลือก Plant, ปี และช่วงเวลา แล้วสร้างรายงานสำหรับพิมพ์เป็น PDF (ข้อมูลจริง แยกตามปีหรือเดือน)'),
  )

  // plant checklist (all selected by default)
  const plantBox = el('div', 'exp-plants')
  plantBox.append(el('span', 'exp-label', 'Plant'))
  const boxes: { id: string; input: HTMLInputElement }[] = []
  for (const p of o.plants) {
    const row = el('label', 'exp-check')
    const input = el('input')
    input.type = 'checkbox'
    input.checked = true
    row.append(input, el('span', '', o.displayName(p)))
    plantBox.append(row)
    boxes.push({ id: p.id, input })
  }

  // granularity radios
  const granBox = el('div', 'exp-gran')
  granBox.append(el('span', 'exp-label', 'ช่วงเวลา'))
  const grans: Granularity[] = ['year', 'month']
  for (const gKey of grans) {
    const row = el('label', 'exp-radio')
    const input = el('input')
    input.type = 'radio'
    input.name = 'exp-gran'
    input.value = gKey
    input.checked = gKey === 'year'
    row.append(input, el('span', '', GRANULARITY_LABELS[gKey]))
    granBox.append(row)
  }

  // year filter (optional — restrict the whole report to one calendar year)
  const yearBox = el('div', 'exp-year')
  yearBox.append(el('span', 'exp-label', 'ปี'))
  const yearSel = el('select', 'exp-select')
  const allOpt = el('option', '', 'ทุกปี')
  allOpt.value = ''
  yearSel.append(allOpt)
  for (const y of yearsOf(o.plants)) {
    const opt = el('option', '', y)
    opt.value = y
    yearSel.append(opt)
  }
  yearBox.append(yearSel)

  const actions = el('div', 'confirm-actions')
  const cancel = el('button', 'c-btn ghost', 'ยกเลิก')
  cancel.type = 'button'
  const make = el('button', 'c-btn primary', 'สร้างรายงาน')
  make.type = 'button'
  actions.append(cancel, make)

  // shown when the user unticks every plant and hits สร้างรายงาน — was a silent no-op before (L4)
  const err = el('p', 'exp-err', 'เลือกอย่างน้อย 1 Plant ก่อนสร้างรายงาน')
  err.hidden = true
  plantBox.addEventListener('change', () => (err.hidden = true)) // ticking a plant clears the warning

  dlg.append(head, plantBox, granBox, yearBox, err, actions)
  document.body.append(dlg)

  const close = (): void => {
    if (dlg.open) dlg.close()
    dlg.remove()
  }
  const chosenGran = (): Granularity =>
    (dlg.querySelector<HTMLInputElement>('input[name="exp-gran"]:checked')?.value as Granularity) ?? 'year'
  const chosenYear = (): string | undefined => yearSel.value || undefined

  cancel.addEventListener('click', close)
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close()
  })
  make.addEventListener('click', () => {
    const ids = new Set(boxes.filter((b) => b.input.checked).map((b) => b.id))
    const chosen = o.plants.filter((p) => ids.has(p.id))
    if (!chosen.length) {
      err.hidden = false
      return
    }
    const html = buildReportHtml(chosen, o.settings, o.displayName, chosenGran(), chosenYear())
    close()
    openReportOverlay(html)
  })

  dlg.showModal()
  make.focus()
}

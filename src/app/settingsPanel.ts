import { csvToGrid } from '../data/csv'
import { resolve } from '../data/metrics'
import { isSupplierGrid, parseSupplierGrid } from '../data/supplierCsv'
import { readXlsxGrid } from '../data/xlsx'
import { downloadSupplierTemplate } from './templates'
import {
  DEFAULT_SETTINGS,
  GLOBAL_KEY,
  globalSettings,
  missingSettings,
  REQUIRED_FIELDS,
  supplierKwh,
  supplierYearsOf,
  withDefaults,
  type PlantSettings,
  type SettingsMap,
  type SupplierYear,
} from '../data/settings'
import type { Plant } from '../data/types'
import { confirmDialog } from './confirm'

/**
 * Settings dialog with two tabs:
 *   - "ตั้งค่ารวม (ทุก Plant)": the system-wide policy, set once for every plant (anomaly threshold + re-invest age).
 *   - "ตั้งค่าเฉพาะ Plant": each plant's own values (incl. PR / sun hours / tariff / payback), plus the per-plant override of a system-wide field.
 * Resolution order is per-plant override → global → built-in default / auto. A blank field inherits
 * the layer beneath it; grey placeholder text says what that inherited value is.
 */

export interface SettingsPanelOpts {
  plants: Plant[]
  settings: SettingsMap
  plantId: string
  displayName(p: Plant): string
  onSave(plantValues: Record<string, Partial<PlantSettings>>, global: Partial<PlantSettings>): void
  onRemove(plantId: string): void
  /** Optional: open straight to this field (from the bell) — switch to its tab, scroll, pulse + focus it. */
  focus?: { key: Key; scope: Scope }
}

type Key = keyof PlantSettings
type Scope = 'global' | 'plant'
interface Field {
  key: Key
  label: string
  kind: 'text' | 'date' | 'number' | 'percent' | 'money' // percent: shown ×100, stored as a fraction; money: thousands-grouped text (whole baht)
  unit?: string
  tip: string
  scope: Scope // global = system-wide (shown in both tabs); plant = per-plant only
  globalOnly?: boolean // global-only: shown in the global tab, never offered as a per-plant override
}

// Editable fields. Order within each scope is the order shown.
const FIELDS: Field[] = [
  // per-plant: identity + size
  { key: 'name', label: 'ชื่อที่แสดง', kind: 'text', scope: 'plant', tip: 'ชื่อที่โชว์บน dashboard แทนรหัส Plant (เว้นว่าง = ใช้รหัส)' },
  { key: 'startDate', label: 'วันเริ่มใช้งาน', kind: 'date', scope: 'plant', tip: 'วันที่ระบบเริ่มผลิตไฟ ใช้คำนวณอายุและการคืนทุน' },
  { key: 'kWp', label: 'ขนาดติดตั้ง', kind: 'number', unit: 'kWp', scope: 'plant', tip: 'กำลังผลิตสูงสุดของแผงที่ติดตั้ง เป็นตัวหารหลักของค่า Efficiency' },
  // per-plant: production assumptions (each plant can differ; blank uses the built-in default)
  { key: 'performanceRatio', label: 'Performance Ratio', kind: 'percent', unit: '%', scope: 'plant', tip: '% ที่ระบบผลิตได้จริงเทียบกับทฤษฎี (รวมการสูญเสีย) ปกติ 75–85%' },
  { key: 'sunHours', label: 'ชั่วโมงแดดต่อวัน', kind: 'number', unit: 'ชม.', scope: 'plant', tip: 'ชั่วโมงที่แดดแรงเต็มที่เฉลี่ยต่อวันของพื้นที่ (Peak Sun Hours)' },
  // per-plant: money (each plant can differ; blank uses the built-in default)
  { key: 'investment', label: 'เงินลงทุน', kind: 'money', unit: '฿', scope: 'plant', tip: 'เงินที่ลงทุนติดตั้งระบบนี้ ใช้คำนวณระยะคืนทุน' },
  { key: 'tariff', label: 'ค่าไฟ', kind: 'number', unit: '฿/kWh', scope: 'plant', tip: 'ราคาต่อหน่วยไฟ ใช้คำนวณมูลค่าที่ประหยัดและการคืนทุน · เป็นราคาสำรอง — ปีไหนที่ตาราง ค่า Simulate กรอก Peak Rate / Off-Peak Rate ไว้ ปีนั้นจะใช้ราคาเฉลี่ยจากตารางแทน ค่านี้จะถูกใช้เฉพาะปีที่กรอกแต่ kWh หรือเว้นว่างทั้งแถว' },
  { key: 'paybackPlanYears', label: 'แผนคืนทุน', kind: 'number', unit: 'ปี', scope: 'plant', tip: 'จำนวนปีเป้าหมายที่ต้องการคืนทุน' },
  // per-plant: simulate comparison
  { key: 'peakTestFactor', label: 'Peak Test เทียบ Simulate', kind: 'percent', unit: '%', scope: 'plant', tip: '% ผลวัดจริงเทียบกับค่าที่จำลองไว้ ของ Plant นี้' },
  // system-wide: shown in the global tab only (used by every plant, not overridable per plant)
  { key: 'abnormalBelow', label: 'ผิดปกติเมื่อ Efficiency ต่ำกว่า', kind: 'percent', unit: '%', scope: 'global', globalOnly: true, tip: 'ถ้า Efficiency ต่ำกว่า % นี้ จะถูกทำเครื่องหมายว่าผิดปกติ · ใช้กับทุก Plant (ตั้งแยกราย Plant ไม่ได้)' },
  { key: 'reinvestAge', label: 'เส้นอายุ Re-invest', kind: 'number', unit: 'ปี', scope: 'global', globalOnly: true, tip: 'เส้นประแนวนอน "Age of Plant" ในกราฟ Efficiency–Age: Plant ที่อายุเกินค่านี้ควรพิจารณาลงทุนใหม่ · ใช้กับทุก Plant (ตั้งแยกราย Plant ไม่ได้)' },
]

// Shown read-only in the plant tab: always computed, never stored.
const PEAK_TIP = 'พลังงานที่ควรผลิตได้ต่อวัน = kWp × ชั่วโมงแดด × PR (คำนวณอัตโนมัติ)'

const byKey = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<Key, Field>
const PLANT_FIELDS = FIELDS.filter((f) => f.scope === 'plant')
const GLOBAL_FIELDS = FIELDS.filter((f) => f.scope === 'global')

const round = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d)

function show(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (f.kind === 'percent') return round(Number(v) * 100, 1)
  if (f.kind === 'money') return Math.round(Number(v)).toLocaleString('en-US')
  return String(v)
}

function read(f: Field, input: HTMLInputElement): unknown {
  const t = input.value.trim()
  if (!t) return undefined
  if (f.kind === 'text' || f.kind === 'date') return t
  const n = Number(f.kind === 'money' ? t.replace(/,/g, '') : t)
  if (!Number.isFinite(n)) return undefined
  // backstop clamp: a percent field is a ratio, so cap it at 100% (and floor at 0) before storing as
  // a fraction — the on-blur clamp handles the visible value; this guards programmatic / un-blurred edits.
  return f.kind === 'percent' ? Math.min(100, Math.max(0, n)) / 100 : n
}

/** Reformat a money text input to thousands-grouped whole digits, keeping the caret near its digit. */
function formatMoney(input: HTMLInputElement): void {
  const before = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length
  const digits = input.value.replace(/\D/g, '')
  const grouped = digits ? Number(digits).toLocaleString('en-US') : ''
  input.value = grouped
  let pos = 0
  for (let seen = 0; pos < grouped.length && seen < before; pos++) if (/\d/.test(grouped[pos])) seen++
  input.setSelectionRange(pos, pos)
}

/** The grey auto-value shown when a per-plant field is left blank (computed through the global layer). */
function autoHint(f: Field, plant: Plant, raw: Partial<PlantSettings>, base: PlantSettings): string {
  const r = resolve(plant, withDefaults({ ...raw, [f.key]: undefined }, base))
  switch (f.key) {
    case 'name':
      return plant.id
    case 'kWp':
      return `อัตโนมัติ ≈ ${round(r.kWp, 1)}`
    case 'investment':
      return `อัตโนมัติ ≈ ${Math.round(r.investment).toLocaleString('en-US')}`
    case 'startDate':
      return r.startDate // first day of real data when left blank
    default:
      return ''
  }
}

let open: HTMLDialogElement | null = null

/**
 * The four columns of the supplier's table, in the order their document prints them. `unit` rides in
 * the column head rather than beside every cell: the head is sticky, so the unit stays on screen all
 * the way down 25 rows, while a unit repeated in 100 cells would bury the figures it describes. The
 * placeholder carries it too, so an empty cell says what it wants before anything is typed.
 */
type SupplierCol = 'peakRate' | 'peakKwh' | 'offRate' | 'offKwh'
const SUPPLIER_COLS: { key: SupplierCol; head: string; unit: string }[] = [
  { key: 'peakRate', head: 'Peak Rate', unit: '฿/kWh' },
  { key: 'peakKwh', head: 'Peak Energy', unit: 'kWh' },
  { key: 'offRate', head: 'Off-Peak Rate', unit: '฿/kWh' },
  { key: 'offKwh', head: 'Off-Peak Energy', unit: 'kWh' },
]

/**
 * Sub-dialog for the supplier's projection: one row per project year, four columns per row — the same
 * four their document prints. Every cell is a straight copy off the page and the dashboard does the
 * adding up, because the step where a reader has to total two columns by hand is the step where one
 * column gets entered and the other left behind.
 *   • "จำนวนปี" + "สร้างตาราง" lays out that many blank year rows,
 *   • pasting a whole column (whitespace/comma separated) into any cell fills THAT column downwards,
 *   • a fifth, read-only column shows what the four come to — read it against the document's own "Total
 *     Yearly Energy Saving" and a row typed into the wrong box shows up before the dialog closes.
 * "ใช้ค่านี้" hands back one entry per project year; a blank year comes back as zeros, which metrics reads
 * as "no supplier figure, use the formula", and a trailing run of blank years is trimmed.
 */
function openSupplierDialog(opts: {
  title: string
  /** plant name, for the downloaded file */
  fileName: string
  startYear: number
  initial: SupplierYear[]
  onApply: (years: SupplierYear[]) => void
}): void {
  const dlg = document.createElement('dialog')
  dlg.className = 'settings supplier'
  const form = document.createElement('form')
  form.method = 'dialog'

  const h = Object.assign(document.createElement('h2'), { textContent: opts.title })
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent =
    'ตารางของผู้ขาย — ลอกสี่คอลัมน์ลงมาตรงๆ ไม่ต้องบวกเอง · แอปจะรวม kWh สองช่วงเป็นเป้าของเส้น Simulate และคิดราคาเฉลี่ยจากอัตราทั้งสองให้เอง · ช่องขวาสุดคือผลที่แอปคำนวณได้ เอาไปเทียบกับคอลัมน์ Total Yearly Energy Saving ในเอกสาร ถ้าตรงแปลว่ากรอกถูกช่อง · เว้นว่างทั้งแถว = ปีนั้นใช้สูตรเดิม · วางทั้งคอลัมน์จากเอกสารลงช่องแรกของคอลัมน์นั้นได้'

  const numInput = (ph: string, value = ''): HTMLInputElement => {
    const i = document.createElement('input')
    i.type = 'text'
    i.inputMode = 'decimal'
    i.placeholder = ph
    i.value = value
    return i
  }
  const span = (cls: string, text: string): HTMLElement =>
    Object.assign(document.createElement('span'), { className: cls, textContent: text })
  const wrap = (label: string, el: HTMLElement): HTMLElement => {
    const l = document.createElement('label')
    l.className = 'supplier-field'
    l.append(span('', label), el)
    return l
  }

  // ── row builder: pick how many years, then fill the table in ──
  const count = numInput('ปี', String(Math.max(opts.initial.length, 25)))
  const genBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: 'สร้างตาราง' })
  const gen = document.createElement('div')
  gen.className = 'supplier-gen'
  gen.append(wrap('จำนวนปี', count), genBtn)

  // ── per-year table ──
  const table = document.createElement('div')
  table.className = 'supplier-table'
  const head = document.createElement('div')
  head.className = 'supplier-head'
  const headCell = (name: string, unit: string): HTMLElement => {
    const cell = document.createElement('span')
    cell.append(span('sy-h-name', name))
    if (unit) cell.append(span('sy-h-unit', unit))
    return cell
  }
  head.append(
    headCell('ปี', ''),
    ...SUPPLIER_COLS.map((col) => headCell(col.head, col.unit)),
    headCell('แอปคำนวณได้', 'kWh · ฿'),
  )

  const rows: { inputs: Record<SupplierCol, HTMLInputElement>; out: HTMLElement }[] = []
  const num = (i: HTMLInputElement): number => {
    const n = Number(i.value.replace(/,/g, '').trim())
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  /**
   * Thousand separators while the figure is being typed. These run to six digits, where 100182 and
   * 10182 look alike at a glance; grouped, a dropped digit shows up in the cell it was typed into
   * rather than in the totals a page later. Only the part before the dot is grouped and the rest is
   * left exactly as typed, so "4." on the way to "4.313" survives; num() strips the commas again.
   */
  const grouped = (raw: string): string => {
    const cleaned = raw.replace(/[^\d.]/g, '')
    const dot = cleaned.indexOf('.')
    const int = dot < 0 ? cleaned : cleaned.slice(0, dot)
    const frac = dot < 0 ? '' : '.' + cleaned.slice(dot + 1).replace(/\./g, '')
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac
  }
  /** Re-group what is in the box, leaving the caret beside the same digit it was next to. */
  const regroup = (i: HTMLInputElement): void => {
    const next = grouped(i.value)
    if (next === i.value) return
    const before = i.value.slice(0, i.selectionStart ?? i.value.length).replace(/[^\d.]/g, '').length
    i.value = next
    if (document.activeElement !== i) return
    let seen = 0
    let pos = 0
    while (pos < next.length && seen < before) {
      if (next[pos] !== ',') seen++
      pos++
    }
    i.setSelectionRange(pos, pos)
  }
  const valueOf = (r: (typeof rows)[number]): SupplierYear => ({
    peakRate: num(r.inputs.peakRate),
    peakKwh: num(r.inputs.peakKwh),
    offRate: num(r.inputs.offRate),
    offKwh: num(r.inputs.offKwh),
  })
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US')
  /** The check column: what the two periods add up to, and what they are worth at the two prices. */
  const refresh = (): void => {
    for (const r of rows) {
      const v = valueOf(r)
      const kwh = v.peakKwh + v.offKwh
      const thb = v.peakRate * v.peakKwh + v.offRate * v.offKwh
      r.out.textContent = kwh > 0 ? `${fmt(kwh)} kWh${thb > 0 ? ` · ${fmt(thb)} ฿` : ''}` : ''
    }
  }

  const buildTable = (n: number, values: SupplierYear[]): void => {
    table.replaceChildren(head)
    rows.length = 0
    for (let k = 0; k < n; k++) {
      const row = document.createElement('div')
      row.className = 'supplier-year'
      row.append(span('sy-year', `ปีที่ ${k + 1} · ${opts.startYear + k}`))
      const inputs = {} as Record<SupplierCol, HTMLInputElement>
      for (const col of SUPPLIER_COLS) {
        const inp = numInput(col.unit)
        const v = values[k]?.[col.key]
        inp.value = v && v > 0 ? grouped(String(v)) : ''
        inp.addEventListener('input', () => {
          regroup(inp)
          refresh()
        })
        inp.addEventListener('paste', (e) => {
          const text = e.clipboardData?.getData('text') ?? ''
          // A column off a sheet arrives one value per line or per tab. A comma inside it is a
          // thousand separator, so it must never split one figure into two rows.
          const lines = text.split(/[\r\n\t]+/).map((t) => t.trim()).filter(Boolean)
          const parts = lines.length > 1 ? lines : text.trim().split(/\s+/).filter(Boolean)
          if (parts.length <= 1) return // a single value → the browser pastes it, then 'input' groups it
          e.preventDefault()
          parts.forEach((part, j) => {
            const target = rows[k + j]
            if (!target) return
            const parsed = Number(part.replace(/,/g, ''))
            target.inputs[col.key].value = Number.isFinite(parsed) && parsed > 0 ? grouped(String(parsed)) : ''
          })
          refresh()
        })
        inputs[col.key] = inp
        row.append(inp)
      }
      const out = span('sy-out', '')
      row.append(out)
      table.append(row)
      rows.push({ inputs, out })
    }
    refresh()
  }
  buildTable(Math.max(opts.initial.length, 25), opts.initial)

  // ── file in / file out (top right, beside the row builder) ──
  // Download writes the table as it stands — as many rows as are on screen, carrying whatever is typed
  // in — so one button serves as both the blank form and a backup to edit in Excel. Import fills the
  // table but does NOT save: the green check column is there to be read against the document first,
  // and "ใช้ค่านี้" still has the last word.
  const msg = document.createElement('p')
  msg.className = 'supplier-msg'
  msg.hidden = true
  const say = (text: string, bad: boolean): void => {
    msg.textContent = text
    msg.classList.toggle('bad', bad)
    msg.hidden = false
  }
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = '.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  file.hidden = true
  const tools = document.createElement('div')
  tools.className = 'supplier-tools'
  const toolBtn = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: text })
    b.addEventListener('click', onClick)
    tools.append(b)
    return b
  }
  toolBtn('ดาวน์โหลดเทมเพลต (Excel)', () =>
    downloadSupplierTemplate(opts.fileName, opts.startYear, rows.map(valueOf), rows.length),
  )
  toolBtn('นำเข้าไฟล์', () => file.click())
  tools.append(file)
  gen.append(tools)

  file.addEventListener('change', () => {
    const picked = file.files?.[0]
    file.value = '' // allow re-picking the same file
    if (!picked) return
    void (async () => {
      try {
        const grid = /\.xlsx$/i.test(picked.name) ? await readXlsxGrid(await picked.arrayBuffer()) : csvToGrid(await picked.text())
        if (!isSupplierGrid(grid)) {
          say('ไฟล์นี้ไม่ใช่ตารางค่า Simulate — ต้องมีหัวคอลัมน์ "ปี" และคอลัมน์ Peak / Off-Peak Energy · กด "ดาวน์โหลดเทมเพลต" เพื่อดูรูปแบบที่ถูกต้อง', true)
          return
        }
        const parsed = parseSupplierGrid(grid, opts.startYear)
        buildTable(Math.max(parsed.years.length, rows.length), parsed.years)
        const skipped = parsed.skipped ? ` · ข้าม ${parsed.skipped} แถวที่ปีอยู่นอกช่วงของตาราง` : ''
        say(`อ่านได้ ${parsed.filled} ปี${skipped} · ตรวจช่องขวาสุดให้ตรงกับเอกสาร แล้วกด "ใช้ค่านี้"`, false)
      } catch (err) {
        say(err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ', true)
      }
    })()
  })

  genBtn.addEventListener('click', () => {
    const n = Math.max(1, Math.min(60, Math.round(Number(count.value.trim()) || 25)))
    buildTable(n, []) // blank rows — fill them in by hand, or paste a column at a time
  })

  // ── actions ──
  const actions = document.createElement('div')
  actions.className = 'actions'
  const close = (): void => {
    if (dlg.open) dlg.close()
    dlg.remove()
  }
  const mkBtn = (text: string, cls: string, onClick: () => void, type: 'button' | 'submit' = 'button'): void => {
    const b = Object.assign(document.createElement('button'), { type, className: cls, textContent: text })
    b.addEventListener('click', onClick)
    actions.append(b)
  }
  mkBtn('ล้างทั้งหมด', 'ghost', () => {
    for (const r of rows) for (const col of SUPPLIER_COLS) r.inputs[col.key].value = ''
    refresh()
  })
  mkBtn('ยกเลิก', 'ghost', () => close())
  mkBtn(
    'ใช้ค่านี้',
    'primary',
    () => {
      const years = rows.map(valueOf)
      while (years.length && years[years.length - 1].peakKwh <= 0 && years[years.length - 1].offKwh <= 0) years.pop()
      opts.onApply(years)
      close()
    },
    'submit',
  )

  dlg.addEventListener('close', () => dlg.remove())
  form.append(h, note, gen, msg, table, actions)
  dlg.append(form)
  document.body.append(dlg)
  dlg.showModal()
}

export function openSettings(o: SettingsPanelOpts): void {
  open?.remove()
  const dlg = document.createElement('dialog')
  dlg.className = 'settings'
  dlg.setAttribute('aria-label', 'ตั้งค่า Plant')
  open = dlg

  const form = document.createElement('form')
  form.method = 'dialog'
  const h = document.createElement('h2')
  h.textContent = 'ตั้งค่า'

  // one "?" help bubble next to a label; hover (desktop) / tap (mobile) / focus (keyboard) shows it
  let openTip: HTMLElement | null = null
  const closeTips = (): void => {
    openTip?.classList.remove('on')
    openTip = null
  }
  // open half-year popups (one per tariff row); any dialog-level click closes them
  const popups: HTMLElement[] = []
  const closePopups = (): void => popups.forEach((p) => (p.hidden = true))
  const helpBtn = (tip: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'help'
    b.textContent = '?'
    b.setAttribute('aria-label', `คำอธิบาย: ${tip}`)
    const t = document.createElement('span')
    t.className = 'tip'
    t.setAttribute('role', 'tooltip')
    t.textContent = tip
    b.append(t)
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation() // keep the dialog-level click from immediately closing it
      const wasOpen = b.classList.contains('on')
      closeTips()
      if (!wasOpen) {
        b.classList.add('on')
        openTip = b
      }
    })
    return b
  }
  dlg.addEventListener('click', () => {
    closeTips() // tap anywhere else closes an open tooltip
    closePopups() // ...and any open half-year popup
  })

  // a labelled field row (label + "?" + input + unit); registers the input into `inputs`
  const makeRow = (f: Field, inputs: Map<Key, HTMLInputElement>, units: Map<Key, HTMLElement>): HTMLElement => {
    const row = document.createElement('label')
    row.className = 'row'
    const span = document.createElement('span')
    span.append(document.createTextNode(f.label + ' '), helpBtn(f.tip))
    const input = document.createElement('input')
    input.type = f.kind === 'percent' ? 'number' : f.kind === 'money' ? 'text' : f.kind
    if (f.kind === 'number' || f.kind === 'percent') {
      input.step = 'any' // accept any typed value — no "nearest valid value" snapping (spinner still works)
      input.min = '0'
    }
    if (f.kind === 'percent') {
      input.max = '100' // a ratio can't exceed 100% (M6)
      // `max` only constrains the spinner, not typed input — clamp the visible value on blur so an
      // over-100 (or negative) entry is capped where the user can see it, not silently at save time.
      input.addEventListener('change', () => {
        const n = Number(input.value)
        if (!Number.isFinite(n) || (n <= 100 && n >= 0)) return
        input.value = String(Math.min(100, Math.max(0, n)))
        input.dispatchEvent(new Event('input', { bubbles: true })) // recompute hints with the clamped value
      })
    }
    if (f.kind === 'money') {
      input.inputMode = 'numeric'
      input.addEventListener('input', () => formatMoney(input))
    }
    inputs.set(f.key, input)
    const unit = document.createElement('small')
    unit.textContent = f.unit ?? ''
    // the startDate row has no unit; it shows the long "อัตโนมัติ: YYYY-MM-DD" hint instead, which must
    // read on one line under the input (the 48px unit column would wrap it into unreadable stacked bits)
    if (f.key === 'startDate') unit.className = 'auto-hint'
    units.set(f.key, unit)
    row.append(span, input, unit)
    return row
  }

  // ── ค่าไฟ ครึ่งปี / รายปี (tariff only) ──────────────────
  // The ค่าไฟ row shows one editable price with a button to its right. The button opens a popup that can
  // (a) split the year into เดือน 1-6 (`tariff`) + เดือน 7-12 (`tariffH2`), and (b) override the price for
  // a specific project year (`tariffYearly`, index 0 = commissioning year). The popup has a year picker:
  // "ทุกปี (ค่าเริ่มต้น)" edits the base price (the hidden h1/h2 inputs collect()/loadPlant()/addH2() read),
  // a chosen year edits that year's half-year prices (kept in a local map, read back via readYearly). A
  // blank year falls back to the base. While customised, the main field is a read-only summary. Plant tab only.
  const h2Inputs = new Map<Scope, HTMLInputElement>()
  const isSplit = new Map<Scope, () => boolean>()
  const setSplit = new Map<Scope, (on: boolean) => void>()
  const syncDisplays = new Map<Scope, () => void>() // push H1 value/placeholder onto the visible field
  // per-year wiring, filled inside makeTariffRow and used by loadPlant()/stashCurrent() below
  const seedYearly = new Map<Scope, (arr: NonNullable<PlantSettings['tariffYearly']>, years: number[]) => void>()
  const readYearly = new Map<Scope, () => NonNullable<PlantSettings['tariffYearly']>>()
  const makeTariffRow = (f: Field, scope: Scope, inputs: Map<Key, HTMLInputElement>, units: Map<Key, HTMLElement>): HTMLElement => {
    const row = document.createElement('label')
    row.className = 'row tariff-row'
    const span = document.createElement('span')
    span.append(document.createTextNode(f.label + ' '), helpBtn(f.tip))

    // visible field: single editable price when plain, read-only summary when split/per-year
    const display = document.createElement('input')
    display.type = 'text'
    display.inputMode = 'decimal'
    display.className = 'tariff-main'

    const mkInput = (): HTMLInputElement => {
      const i = document.createElement('input')
      i.type = 'number'
      i.min = '0'
      i.step = 'any' // no step snapping — type any price
      return i
    }
    // base (ทุกปี) source-of-truth inputs — collect()/loadPlant()/addH2() read these; kept hidden in the row
    const h1 = mkInput()
    inputs.set(f.key, h1)
    const h2 = mkInput()
    h2Inputs.set(scope, h2)
    h1.hidden = true
    h2.hidden = true
    // visible editors inside the popup — they show the base values or a chosen year's values
    const eh1 = mkInput()
    const eh2 = mkInput()

    // unit + the toggle button sit in the row's own unit / button columns (shared with makeRow)
    const unit = document.createElement('small')
    unit.textContent = f.unit ?? ''
    units.set(f.key, unit)
    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.className = 'halfyear'

    // popup: year picker + the two half-year inputs + clear / ok
    const pop = document.createElement('div')
    pop.className = 'hy-popup'
    pop.hidden = true
    pop.addEventListener('click', (e) => e.stopPropagation()) // clicks inside must not close it
    popups.push(pop)
    const hyRow = (label: string, input: HTMLElement): HTMLElement => {
      const r = document.createElement('label')
      r.className = 'hy-row'
      r.append(Object.assign(document.createElement('span'), { textContent: label }), input)
      return r
    }
    const yearSel = document.createElement('select')
    const clearBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'ล้าง' })
    const okBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'ตกลง' })
    const popActions = document.createElement('div')
    popActions.className = 'hy-actions'
    popActions.append(clearBtn, okBtn)
    pop.append(
      Object.assign(document.createElement('p'), { className: 'hy-title', textContent: 'ค่าไฟ ครึ่งปี / รายปี (฿/kWh)' }),
      hyRow('ปี', yearSel),
      hyRow('เดือน 1-6', eh1),
      hyRow('เดือน 7-12', eh2),
      popActions,
    )

    row.append(span, display, unit, openBtn, pop, h1, h2)

    // per-year overrides: project year → { h1, h2 } (base lives in the hidden h1/h2 inputs)
    const yearly = new Map<number, { h1: string; h2: string }>()
    let selectedKey: 'base' | number = 'base'
    let startYearLocal = new Date().getFullYear()
    let split = false

    const yearHasValue = (y: number): boolean => {
      const v = yearly.get(y)
      return !!v && Number(v.h1) > 0
    }
    const refreshOptions = (years: number[]): void => {
      yearSel.textContent = ''
      yearSel.add(new Option('ทุกปี (ค่าเริ่มต้น)', 'base'))
      for (const y of years) yearSel.add(new Option(yearHasValue(y) ? `ปี ${y} •` : `ปี ${y}`, String(y)))
      yearSel.value = selectedKey === 'base' ? 'base' : String(selectedKey)
    }
    const relabelOptions = (): void => {
      for (const opt of Array.from(yearSel.options)) {
        if (opt.value === 'base') continue
        const y = +opt.value
        opt.text = yearHasValue(y) ? `ปี ${y} •` : `ปี ${y}`
      }
    }
    // load a key's values into the visible editors
    const pull = (key: 'base' | number): void => {
      if (key === 'base') {
        eh1.value = h1.value
        eh2.value = h2.value
      } else {
        const v = yearly.get(key)
        eh1.value = v?.h1 ?? ''
        eh2.value = v?.h2 ?? ''
      }
    }
    // store the visible editors back into a key
    const push = (key: 'base' | number): void => {
      if (key === 'base') {
        h1.value = eh1.value
        h2.value = eh2.value
        h1.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        const a = eh1.value.trim()
        if (a && Number(a) > 0) yearly.set(key, { h1: a, h2: eh2.value.trim() })
        else yearly.delete(key)
      }
    }
    const recomputeSplit = (): void => {
      const baseH2 = Number(h2.value.trim())
      split = (Number.isFinite(baseH2) && baseH2 > 0) || [...yearly.values()].some((v) => Number(v.h1) > 0)
    }

    const sync = (): void => {
      openBtn.textContent = split ? 'แก้ค่าไฟ' : 'ครึ่งปี/รายปี'
      openBtn.classList.toggle('on', split)
      row.classList.toggle('split', split)
      if (split) {
        display.readOnly = true
        display.classList.add('readonly')
        const baseH2 = h2.value.trim()
        const perYear = [...yearly.values()].some((v) => Number(v.h1) > 0)
        const tail = perYear ? ' · รายปี' : ''
        display.value = baseH2 ? `${h1.value || '—'} / ${baseH2}${tail}` : `${h1.value || '—'}${tail}`
      } else {
        display.readOnly = false
        display.classList.remove('readonly')
        display.value = h1.value
        display.placeholder = h1.placeholder
      }
    }
    // editing the single price (not split) flows into base H1, then bubbles so refreshPlant()'s hints recompute
    display.addEventListener('input', () => {
      if (split) return
      h1.value = display.value
      h1.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // while a year is selected the editors feed that year; on base they write through to the hidden base inputs
    const onEdit = (): void => {
      if (selectedKey !== 'base') return
      h1.value = eh1.value
      h2.value = eh2.value
      h1.dispatchEvent(new Event('input', { bubbles: true }))
    }
    eh1.addEventListener('input', onEdit)
    eh2.addEventListener('input', onEdit)
    yearSel.addEventListener('change', () => {
      push(selectedKey)
      selectedKey = yearSel.value === 'base' ? 'base' : +yearSel.value
      pull(selectedKey)
      relabelOptions()
    })
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const wasOpen = !pop.hidden
      closePopups()
      if (!wasOpen) {
        selectedKey = 'base'
        yearSel.value = 'base'
        pull('base')
        relabelOptions()
      }
      pop.hidden = wasOpen
    })
    okBtn.addEventListener('click', () => {
      push(selectedKey)
      recomputeSplit()
      relabelOptions()
      sync()
      pop.hidden = true
      h1.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clearBtn.addEventListener('click', () => {
      if (selectedKey === 'base') {
        h2.value = ''
        eh2.value = ''
      } else {
        yearly.delete(selectedKey)
        eh1.value = ''
        eh2.value = ''
      }
      recomputeSplit()
      relabelOptions()
      sync()
      pop.hidden = true
      h1.dispatchEvent(new Event('input', { bubbles: true }))
    })

    isSplit.set(scope, () => split)
    setSplit.set(scope, (on) => {
      split = on
      sync()
    })
    syncDisplays.set(scope, sync)
    seedYearly.set(scope, (arr, years) => {
      yearly.clear()
      startYearLocal = years[0] ?? new Date().getFullYear()
      arr.forEach((e, i) => {
        if (e && e.h1 > 0) yearly.set(startYearLocal + i, { h1: String(e.h1), h2: e.h2 && e.h2 > 0 ? String(e.h2) : '' })
      })
      selectedKey = 'base'
      refreshOptions(years)
      pull('base')
    })
    readYearly.set(scope, () => {
      push(selectedKey)
      const keys = [...yearly.keys()]
      if (!keys.length) return []
      const max = Math.max(...keys)
      const out: NonNullable<PlantSettings['tariffYearly']> = []
      for (let y = startYearLocal; y <= max; y++) {
        const v = yearly.get(y)
        out.push(v && Number(v.h1) > 0 ? { h1: Number(v.h1), h2: v.h2.trim() && Number(v.h2) > 0 ? Number(v.h2) : null } : { h1: 0, h2: null })
      }
      return out
    })
    return row
  }

  // ── tabs ───────────────────────────────────────────────
  const tabs = document.createElement('div')
  tabs.className = 'tabs settings-tabs'
  tabs.setAttribute('role', 'tablist')
  const tabBtn = (text: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tab'
    b.setAttribute('role', 'tab')
    b.textContent = text
    tabs.append(b)
    return b
  }
  const gTab = tabBtn('ตั้งค่ารวม (ทุก Plant)')
  const pTab = tabBtn('ตั้งค่าเฉพาะ Plant')

  // ── global panel ───────────────────────────────────────
  const gPanel = document.createElement('div')
  gPanel.className = 'panel'
  const gNote = document.createElement('p')
  gNote.className = 'note'
  gNote.textContent = 'ค่าเริ่มต้นที่ใช้กับทุก Plant · ตั้งครั้งเดียว · เว้นว่าง = ใช้ค่ามาตรฐาน'
  const gGrid = document.createElement('div')
  gGrid.className = 'fields'
  const gInputs = new Map<Key, HTMLInputElement>()
  const gUnits = new Map<Key, HTMLElement>()
  for (const f of GLOBAL_FIELDS) gGrid.append(makeRow(f, gInputs, gUnits))
  gPanel.append(gNote, gGrid)

  // ── plant panel ────────────────────────────────────────
  const pPanel = document.createElement('div')
  pPanel.className = 'panel'
  const pick = document.createElement('select')
  pick.setAttribute('aria-label', 'เลือก Plant')
  // ⚠ marks a plant with any REQUIRED_FIELDS value still unfilled (read from stored data, same as the bell)
  for (const p of o.plants) {
    const mark = missingSettings(o.settings, p.id).length ? '⚠ ' : ''
    pick.add(new Option(`${mark}${o.displayName(p)} (${p.id})`, p.id, false, p.id === o.plantId))
  }
  const pickRow = document.createElement('label')
  pickRow.className = 'row pick'
  pickRow.append(Object.assign(document.createElement('span'), { textContent: 'Plant' }), pick)

  const pNote = document.createElement('p')
  pNote.className = 'note'
  pNote.textContent = 'ค่าเฉพาะของ Plant นี้ · เว้นว่าง = ใช้ค่ามาตรฐาน · บันทึกในเบราว์เซอร์นี้'

  const pGrid = document.createElement('div')
  pGrid.className = 'fields'
  const pInputs = new Map<Key, HTMLInputElement>()
  const pUnits = new Map<Key, HTMLElement>()
  for (const f of PLANT_FIELDS) pGrid.append(f.key === 'tariff' ? makeTariffRow(f, 'plant', pInputs, pUnits) : makeRow(f, pInputs, pUnits))

  // read-only auto "Peak Test ต่อวัน"
  const peakRow = document.createElement('div')
  peakRow.className = 'row'
  const peakSpan = document.createElement('span')
  peakSpan.append(document.createTextNode('Peak Test ต่อวัน '), helpBtn(PEAK_TIP))
  const peakOut = document.createElement('input')
  peakOut.readOnly = true
  peakOut.className = 'readonly'
  peakOut.setAttribute('aria-readonly', 'true')
  peakRow.append(peakSpan, peakOut, Object.assign(document.createElement('small'), { textContent: 'kWh' }))
  pGrid.append(peakRow)

  // Supplier Simulate — the supplier's projection for this plant, four columns per project year. The
  // button opens a
  // sub-dialog (generator + editable/pasteable table); the value is stashed per plant and merged on save.
  const supplierDrafts = new Map<string, SupplierYear[]>()
  const supplierRow = document.createElement('div')
  supplierRow.className = 'row supplier-link'
  const supplierSpan = document.createElement('span')
  supplierSpan.append(
    document.createTextNode('ค่า Simulate '),
    helpBtn(
      'ลอกตารางของผู้ขายมาทั้ง 4 คอลัมน์ (Peak Rate / Peak kWh / Off-Peak Rate / Off-Peak kWh) — แอปรวม kWh สองช่วงเป็นเป้าของเส้น Simulate และคิดราคาต่อหน่วยจากอัตราทั้งสองเอง แทนค่าไฟที่ตั้งไว้; กรอกแต่ kWh ก็ได้ ค่าไฟจะใช้ที่ตั้งไว้เหมือนเดิม; ปีที่เว้นว่างกลับไปใช้สูตร',
    ),
  )
  const supplierStatus = Object.assign(document.createElement('small'), { className: 'supplier-status' })
  // status rides in the label column so the grey box can sit in grid col-2 (aligned with the inputs above)
  supplierSpan.append(supplierStatus)
  // read-only peek at THIS year's Simulate value; the user edits every year in the ตั้งค่า table
  const supplierCurrent = Object.assign(document.createElement('input'), { type: 'text', readOnly: true, className: 'sim-current readonly' })
  const supplierBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'pill', textContent: 'ตั้งค่า…' })
  supplierRow.append(supplierSpan, supplierCurrent, supplierBtn)

  pPanel.append(pickRow, pNote, pGrid, supplierRow)

  // ── important-field highlight + "ยังไม่ได้กรอก" warning ──
  // The important fields (the ones we asked the Owner for) get a colored accent; an empty one turns orange
  // so the user sees exactly what still needs a real value. Both lists are DERIVED from REQUIRED_FIELDS,
  // so a field added there lights up here and in the header bell together — the two can't drift apart.
  // Which tab a field lands in comes from its own `scope` in FIELDS, the same split REQUIRED_FIELD_SCOPE
  // reports to the bell.
  const important: { input: HTMLInputElement; row: HTMLElement }[] = []
  const markImportant = (map: Map<Key, HTMLInputElement>, keys: Key[]): void => {
    for (const k of keys) {
      const input = map.get(k)
      const row = input?.closest<HTMLElement>('.row')
      if (!input || !row || row.dataset.req) continue
      row.dataset.req = '1'
      row.classList.add('important')
      input.addEventListener('input', () => row.classList.toggle('missing', !input.value.trim()))
      important.push({ input, row })
    }
  }
  const refreshMissing = (): void => {
    for (const { input, row } of important) row.classList.toggle('missing', !input.value.trim())
  }
  const req = new Set<Key>(REQUIRED_FIELDS)
  const requiredIn = (fields: Field[]): Key[] => fields.filter((f) => req.has(f.key)).map((f) => f.key)
  markImportant(gInputs, requiredIn(GLOBAL_FIELDS))
  markImportant(pInputs, requiredIn(PLANT_FIELDS))

  const plantOf = (): Plant => o.plants.find((p) => p.id === pick.value) ?? o.plants[0]
  // Draft buffer: unsaved plant-tab edits for every plant touched this session. Switching the Plant
  // picker used to reload the next plant straight over the inputs, dropping what you had just typed for
  // the previous one. We now stash the plant you leave here, reload it from here if you come back, and
  // บันทึก writes them all — so filling H1 then moving to H2 keeps H1's values.
  const drafts = new Map<string, Partial<PlantSettings>>()
  let loadedId = plantOf().id
  let plantDirty = false

  // Supplier Simulate wiring (needs plantOf/plantDirty above). The array lives in supplierDrafts once
  // edited, otherwise falls back to the plant's stored value; updateSupplierStatus reflects it on screen.
  const currentSupplier = (): SupplierYear[] => supplierDrafts.get(plantOf().id) ?? supplierYearsOf(o.settings[plantOf().id])
  // project year 1 = commissioning year (startDate), falling back to the first data year, then this year —
  // so the per-year table and the "this year" peek below both index off the same starting year
  const simStartYear = (): number => {
    const sd = pInputs.get('startDate')!.value.trim()
    return +(sd.slice(0, 4) || plantOf().daily[0]?.date.slice(0, 4) || String(new Date().getFullYear()))
  }
  // the years offered in the per-year tariff picker: from the commissioning year through the last data year
  // (at least ~10 years, and far enough to cover any already-stored override), capped so the list stays sane
  const tariffYearList = (plant: Plant, stored?: PlantSettings['tariffYearly']): number[] => {
    const start = simStartYear()
    const lastData = +(plant.daily[plant.daily.length - 1]?.date.slice(0, 4) || start)
    const storedEnd = start + (Array.isArray(stored) ? Math.max(stored.length - 1, 0) : 0)
    const end = Math.min(Math.max(lastData, storedEnd, start + 9), start + 60)
    const years: number[] = []
    for (let y = start; y <= end; y++) years.push(y)
    return years
  }
  const updateSupplierStatus = (): void => {
    const arr = currentSupplier()
    const filled = arr.filter((y) => supplierKwh(y) > 0).length
    const curYear = new Date().getFullYear()
    const v = supplierKwh(arr[curYear - simStartYear()])
    supplierCurrent.value = v > 0 ? `${Math.round(v).toLocaleString('en-US')} kWh` : ''
    supplierCurrent.placeholder = `ปี ${curYear}`
    supplierCurrent.title = `ค่า Simulate ปี ${curYear}`
    supplierStatus.textContent = filled ? `ตั้งแล้ว ${filled} ปี` : 'ยังไม่ได้ตั้ง — ใช้สูตร'
  }
  supplierBtn.addEventListener('click', () => {
    const plant = plantOf()
    openSupplierDialog({
      title: `ค่า Simulate — ${o.displayName(plant)}`,
      fileName: o.displayName(plant),
      startYear: simStartYear(),
      initial: currentSupplier(),
      onApply: (years) => {
        supplierDrafts.set(plant.id, years)
        plantDirty = true
        updateSupplierStatus()
      },
    })
  })
  const readGlobal = (): Partial<PlantSettings> => {
    const g: Partial<PlantSettings> = {}
    for (const f of GLOBAL_FIELDS) {
      const v = read(f, gInputs.get(f.key)!)
      if (v !== undefined) (g as Record<string, unknown>)[f.key] = v
    }
    return g
  }

  // fill the global tab from the stored global layer
  const fillGlobal = (): void => {
    const g = o.settings[GLOBAL_KEY] ?? {}
    for (const f of GLOBAL_FIELDS) {
      const input = gInputs.get(f.key)!
      input.value = show(f, g[f.key])
      input.placeholder = `เริ่มต้น ${show(f, DEFAULT_SETTINGS[f.key])}`
    }
  }

  const inputs = (f: Field): HTMLInputElement => pInputs.get(f.key)!
  // load the current plant's stored values into the plant tab
  const loadPlant = (): void => {
    const raw = drafts.get(plantOf().id) ?? o.settings[plantOf().id] ?? {}
    for (const f of PLANT_FIELDS) inputs(f).value = show(f, raw[f.key])
    // ค่าไฟครึ่งปีหลัง override for this plant; open the split only when the plant has its own H2
    const ph2 = h2Inputs.get('plant')!
    const baseSplit = typeof raw.tariffH2 === 'number' && raw.tariffH2 > 0
    ph2.value = baseSplit ? String(raw.tariffH2) : ''
    // seed the per-year overrides + the year picker for this plant
    seedYearly.get('plant')!(raw.tariffYearly ?? [], tariffYearList(plantOf(), raw.tariffYearly))
    const perYear = Array.isArray(raw.tariffYearly) && raw.tariffYearly.some((e) => e && e.h1 > 0)
    setSplit.get('plant')!(baseSplit || perYear)
    updateSupplierStatus()
  }

  // refresh the grey placeholders + the read-only peak, using the live global tab (so edits reflect)
  const refreshPlant = (): void => {
    const plant = plantOf()
    const raw = o.settings[plant.id] ?? {}
    const gBase = withDefaults(readGlobal()) // live global → DEFAULT for blanks
    for (const f of PLANT_FIELDS) {
      // auto-computed fields (kWp/investment/name) show their estimate; a plain field (peakTestFactor)
      // shows its built-in default so the blank is never mute
      inputs(f).placeholder = autoHint(f, plant, raw, gBase) || `เริ่มต้น ${show(f, DEFAULT_SETTINGS[f.key])}`
    }
    // ค่าไฟครึ่งปีหลัง (เดือน 7-12) — this plant's own second-half price; blank = one price all year
    h2Inputs.get('plant')!.placeholder = 'เดือน 7-12'
    syncDisplays.get('plant')?.() // reflect the freshly-set H1 placeholder on the visible field
    // a date input ignores placeholder → surface the auto start date as grey helper text
    const sd = byKey.startDate
    const sdUnit = pUnits.get('startDate')
    if (sdUnit) sdUnit.textContent = raw.startDate ? '' : `อัตโนมัติ: ${autoHint(sd, plant, raw, gBase)}`
    const r = resolve(plant, withDefaults(raw, gBase))
    peakOut.value = `≈ ${round(r.peakTestKwhPerDay, 1)}`
  }

  // stash edits to the plant you're leaving (only if it was actually edited, so a merely-viewed plant
  // keeps any stored fields the form doesn't show)
  const stashCurrent = (): void => {
    if (!plantDirty) return
    const v = collect(pInputs, PLANT_FIELDS)
    addH2('plant', v)
    // onSave REPLACES each edited plant's settings, so carry the supplier array through (the edited draft,
    // or whatever was stored) — otherwise editing any field would wipe this plant's supplier Simulate.
    const sy = supplierDrafts.get(loadedId) ?? supplierYearsOf(o.settings[loadedId])
    if (sy.some((y) => supplierKwh(y) > 0)) v.supplierTou = sy
    // carry the per-year tariff overrides for the plant on screen (same reason as supplierYearly above)
    const ty = readYearly.get('plant')!()
    if (ty.some((e) => e.h1 > 0)) v.tariffYearly = ty
    drafts.set(loadedId, v)
  }
  const markPlantDirty = (): void => {
    plantDirty = true
  }
  pPanel.addEventListener('input', markPlantDirty)
  pPanel.addEventListener('change', markPlantDirty)
  h2Inputs.get('plant')!.addEventListener('input', markPlantDirty)
  pick.addEventListener('change', () => {
    stashCurrent()
    loadedId = plantOf().id
    loadPlant() // shows the picked plant's draft if it has one, else its stored values
    refreshPlant()
    refreshMissing()
    plantDirty = false // the programmatic load above doesn't count as a user edit
  })
  // editing a global value updates the "ใช้ค่ารวม (…)" hints + the auto peak shown in the plant tab
  for (const f of GLOBAL_FIELDS) gInputs.get(f.key)!.addEventListener('input', refreshPlant)

  // ── actions ────────────────────────────────────────────
  const actions = document.createElement('div')
  actions.className = 'actions'
  const btn = (text: string, cls: string, onClick?: () => void, type: 'button' | 'submit' = 'button') => {
    const b = document.createElement('button')
    b.type = type
    b.className = cls
    b.textContent = text
    if (onClick) b.addEventListener('click', onClick)
    actions.append(b)
    return b
  }
  const removeBtn = btn('ลบ Plant นี้', 'danger', () => {
    const plant = plantOf()
    void (async () => {
      const ok = await confirmDialog({
        title: `ลบ ${o.displayName(plant)}?`,
        message: 'ลบ Plant นี้ออกจากหน้านี้ (ไม่กระทบไฟล์ CSV ต้นฉบับของคุณ)',
        confirmText: 'ลบ Plant',
        danger: true,
      })
      if (!ok) return
      finish()
      o.onRemove(plant.id)
    })()
  })
  btn('ล้างค่าในแท็บนี้', 'ghost', () => {
    const set = activeTab === 'global' ? gInputs : pInputs
    for (const input of set.values()) input.value = ''
    // ค่าไฟ (with its half-year H2 price + split flag) lives in the plant tab only, so reset those when
    // clearing the plant tab — the field inputs alone would leave a stale H2 and the "H1 / H2" split open.
    if (activeTab === 'plant') {
      h2Inputs.get('plant')!.value = ''
      seedYearly.get('plant')!([], tariffYearList(plantOf()))
      setSplit.get('plant')!(false)
      plantDirty = true // a cleared plant must be stashed/saved, not reverted
    }
    refreshPlant() // clearing global changes the "ใช้ค่ารวม (…)" hints too
    refreshMissing() // cleared important fields turn orange again
  })
  btn('ยกเลิก', 'ghost', () => finish())
  btn('บันทึก', 'primary', undefined, 'submit')

  // collect + validate one layer's inputs, keeping only values that survive validation
  const collect = (ins: Map<Key, HTMLInputElement>, fields: Field[]): Partial<PlantSettings> => {
    const values: Partial<PlantSettings> = {}
    for (const f of fields) {
      const v = read(f, ins.get(f.key)!)
      if (v !== undefined) (values as Record<string, unknown>)[f.key] = v
    }
    const clean = withDefaults(values)
    const kept: Partial<PlantSettings> = {}
    for (const k of Object.keys(values) as Key[]) if (clean[k] === values[k]) (kept as Record<string, unknown>)[k] = values[k]
    return kept
  }

  // keep tariffH2 only when the split is on and the second-half input holds a positive price
  const addH2 = (scope: Scope, values: Partial<PlantSettings>): void => {
    const n = Number(h2Inputs.get(scope)!.value.trim())
    if (isSplit.get(scope)!() && Number.isFinite(n) && n > 0) values.tariffH2 = n
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    stashCurrent() // capture the plant on screen too, if it was edited
    const global = collect(gInputs, GLOBAL_FIELDS)
    finish()
    const plantValues: Record<string, Partial<PlantSettings>> = {}
    for (const [id, v] of drafts) plantValues[id] = v
    o.onSave(plantValues, global) // every plant edited this session, not just the visible one
  })

  // ── tab switching ──────────────────────────────────────
  let activeTab: Scope = 'global'
  const setTab = (name: Scope): void => {
    activeTab = name
    gTab.classList.toggle('on', name === 'global')
    pTab.classList.toggle('on', name === 'plant')
    gTab.setAttribute('aria-selected', String(name === 'global'))
    pTab.setAttribute('aria-selected', String(name === 'plant'))
    gPanel.hidden = name !== 'global'
    pPanel.hidden = name !== 'plant'
    removeBtn.style.display = name === 'plant' ? '' : 'none'
    closeTips()
    if (name === 'plant') refreshPlant()
  }
  gTab.addEventListener('click', () => setTab('global'))
  pTab.addEventListener('click', () => setTab('plant'))

  // Esc closes the dialog natively; remove it on every close path
  dlg.addEventListener('close', () => finish())
  function finish(): void {
    if (dlg.open) dlg.close()
    dlg.remove()
    if (open === dlg) open = null
  }

  form.append(h, tabs, gPanel, pPanel, actions)
  dlg.append(form)
  document.body.append(dlg)
  fillGlobal()
  loadPlant()
  refreshMissing()
  // When opened from the bell, go straight to the field: pick its tab FIRST (so its panel is visible),
  // show the dialog, then scroll it into view, pulse it ~2s, and focus it to guide correct entry.
  const target = o.focus
  setTab(target ? (target.scope === 'plant' ? 'plant' : 'global') : 'global')
  dlg.showModal()
  if (target) {
    const map = target.scope === 'plant' ? pInputs : gInputs
    const input = map.get(target.key)
    const row = input?.closest<HTMLElement>('.row')
    if (row && input) {
      // if the field ever sits inside a collapsed section, open it first so scroll/focus lands
      row.closest('details')?.setAttribute('open', '')
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.classList.add('pulse')
      setTimeout(() => row.classList.remove('pulse'), 2000)
      // tariff's real input sits inside a popup; focus the visible field instead when present
      const focusEl = row.querySelector<HTMLInputElement>('input.tariff-main') ?? input
      setTimeout(() => focusEl.focus({ preventScroll: true }), 80)
    }
  }
}

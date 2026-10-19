import { ageYears, formatYM, resolve } from '../data/metrics'
import { DEFAULT_SETTINGS, GLOBAL_KEY, globalSettings, withDefaults, type PlantSettings, type SettingsMap } from '../data/settings'
import type { Plant } from '../data/types'
import { confirmDialog } from './confirm'

/**
 * Settings dialog with two tabs:
 *   - "ตั้งค่ารวม (ทุก Plant)": the system-wide defaults, set once for every plant.
 *   - "ตั้งค่าเฉพาะ Plant": each plant's own values, plus per-plant overrides of the global fields.
 * Resolution order is per-plant override → global → built-in default / auto. A blank field inherits
 * the layer beneath it; grey placeholder text says what that inherited value is.
 */

export interface SettingsPanelOpts {
  plants: Plant[]
  settings: SettingsMap
  plantId: string
  displayName(p: Plant): string
  onSave(plantId: string, values: Partial<PlantSettings>, global: Partial<PlantSettings>): void
  onRemove(plantId: string): void
}

type Key = keyof PlantSettings
type Scope = 'global' | 'plant'
interface Field {
  key: Key
  label: string
  kind: 'text' | 'date' | 'number' | 'percent' // percent: shown ×100, stored as a fraction
  unit?: string
  step?: string
  tip: string
  scope: Scope // global = system-wide (shown in both tabs); plant = per-plant only
}

// Editable fields. Order within each scope is the order shown.
const FIELDS: Field[] = [
  // per-plant
  { key: 'name', label: 'ชื่อที่แสดง', kind: 'text', scope: 'plant', tip: 'ชื่อที่โชว์บน dashboard แทนรหัส Plant (เว้นว่าง = ใช้รหัส)' },
  { key: 'startDate', label: 'วันเริ่มใช้งาน', kind: 'date', scope: 'plant', tip: 'วันที่ระบบเริ่มผลิตไฟ ใช้คำนวณอายุและการคืนทุน' },
  { key: 'ageYears', label: 'อายุระบบ (ปี)', kind: 'number', unit: 'ปี', step: '0.5', scope: 'plant', tip: 'ตั้งอายุระบบที่จะแสดงบนการ์ดและกราฟเอง (เว้นว่าง = คำนวณจากวันเริ่มใช้งาน) ไม่กระทบการคำนวณจุดคืนทุน' },
  { key: 'kWp', label: 'ขนาดติดตั้ง', kind: 'number', unit: 'kWp', step: '0.1', scope: 'plant', tip: 'กำลังผลิตสูงสุดของแผงที่ติดตั้ง เป็นตัวหารหลักของค่า Efficiency' },
  { key: 'investment', label: 'เงินลงทุน', kind: 'number', unit: '฿', step: '1000', scope: 'plant', tip: 'เงินที่ลงทุนติดตั้งระบบนี้ ใช้คำนวณระยะคืนทุน' },
  { key: 'peakTestFactor', label: 'Peak Test เทียบ Simulate', kind: 'percent', unit: '%', step: '1', scope: 'plant', tip: '% ผลวัดจริงเทียบกับค่าที่จำลองไว้ ของ Plant นี้' },
  // system-wide (also shown as overrides in the plant tab)
  { key: 'performanceRatio', label: 'Performance Ratio', kind: 'percent', unit: '%', step: '1', scope: 'global', tip: '% ที่ระบบผลิตได้จริงเทียบกับทฤษฎี (รวมการสูญเสีย) ปกติ 75–85%' },
  { key: 'sunHours', label: 'ชั่วโมงแดดต่อวัน', kind: 'number', unit: 'ชม.', step: '0.1', scope: 'global', tip: 'ชั่วโมงที่แดดแรงเต็มที่เฉลี่ยต่อวันของพื้นที่ (Peak Sun Hours)' },
  { key: 'tariff', label: 'ค่าไฟ', kind: 'number', unit: '฿/kWh', step: '0.01', scope: 'global', tip: 'ราคาต่อหน่วยไฟ ใช้คำนวณมูลค่าที่ประหยัดและการคืนทุน' },
  { key: 'abnormalBelow', label: 'ผิดปกติเมื่อ Efficiency ต่ำกว่า', kind: 'percent', unit: '%', step: '1', scope: 'global', tip: 'ถ้า Efficiency ต่ำกว่า % นี้ จะถูกทำเครื่องหมายว่าผิดปกติ' },
  { key: 'paybackPlanYears', label: 'แผนคืนทุน', kind: 'number', unit: 'ปี', step: '0.5', scope: 'global', tip: 'จำนวนปีเป้าหมายที่ต้องการคืนทุน' },
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
  return String(v)
}

function read(f: Field, input: HTMLInputElement): unknown {
  const t = input.value.trim()
  if (!t) return undefined
  if (f.kind === 'text' || f.kind === 'date') return t
  const n = Number(t)
  if (!Number.isFinite(n)) return undefined
  return f.kind === 'percent' ? n / 100 : n
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
    case 'ageYears':
      return `อัตโนมัติ ≈ ${formatYM(ageYears(r.startDate, plant.daily[plant.daily.length - 1]?.date ?? r.startDate))}` // computed from the commissioning date
    default:
      return ''
  }
}

let open: HTMLDialogElement | null = null

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
  dlg.addEventListener('click', closeTips) // tap anywhere else closes an open tooltip

  // a labelled field row (label + "?" + input + unit); registers the input into `inputs`
  const makeRow = (f: Field, inputs: Map<Key, HTMLInputElement>, units: Map<Key, HTMLElement>): HTMLElement => {
    const row = document.createElement('label')
    row.className = 'row'
    const span = document.createElement('span')
    span.append(document.createTextNode(f.label + ' '), helpBtn(f.tip))
    const input = document.createElement('input')
    input.type = f.kind === 'percent' ? 'number' : f.kind
    if (f.step) input.step = f.step
    if (f.kind !== 'text' && f.kind !== 'date') input.min = '0'
    inputs.set(f.key, input)
    const unit = document.createElement('small')
    unit.textContent = f.unit ?? ''
    units.set(f.key, unit)
    row.append(span, input, unit)
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
  for (const p of o.plants) pick.add(new Option(`${o.displayName(p)} (${p.id})`, p.id, false, p.id === o.plantId))
  const pickRow = document.createElement('label')
  pickRow.className = 'row pick'
  pickRow.append(Object.assign(document.createElement('span'), { textContent: 'Plant' }), pick)

  const pNote = document.createElement('p')
  pNote.className = 'note'
  pNote.textContent = 'ค่าเฉพาะของ Plant นี้ · ช่องค่ารวมเว้นว่าง = สืบทอดจากตั้งค่ารวม · บันทึกในเบราว์เซอร์นี้'

  const pGrid = document.createElement('div')
  pGrid.className = 'fields'
  const pInputs = new Map<Key, HTMLInputElement>()
  const pUnits = new Map<Key, HTMLElement>()
  for (const f of PLANT_FIELDS) pGrid.append(makeRow(f, pInputs, pUnits))

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

  // overrides of the global fields, each inheriting the global value unless filled
  const sub = document.createElement('div')
  sub.className = 'subhead'
  sub.textContent = 'ค่ารวม (เว้นว่าง = ใช้ค่ารวม · กรอก = เฉพาะ Plant นี้)'
  pGrid.append(sub)
  for (const f of GLOBAL_FIELDS) pGrid.append(makeRow(f, pInputs, pUnits))
  pPanel.append(pickRow, pNote, pGrid)

  const plantOf = (): Plant => o.plants.find((p) => p.id === pick.value) ?? o.plants[0]
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
    const raw = o.settings[plantOf().id] ?? {}
    for (const f of [...PLANT_FIELDS, ...GLOBAL_FIELDS]) inputs(f).value = show(f, raw[f.key])
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
    for (const f of GLOBAL_FIELDS) inputs(f).placeholder = `ใช้ค่ารวม (${show(f, gBase[f.key])})`
    // a date input ignores placeholder → surface the auto start date as grey helper text
    const sd = byKey.startDate
    const sdUnit = pUnits.get('startDate')
    if (sdUnit) sdUnit.textContent = raw.startDate ? '' : `อัตโนมัติ: ${autoHint(sd, plant, raw, gBase)}`
    const r = resolve(plant, withDefaults(raw, gBase))
    peakOut.value = `≈ ${round(r.peakTestKwhPerDay, 1)}`
  }

  pick.addEventListener('change', () => {
    loadPlant()
    refreshPlant()
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
    refreshPlant() // clearing global changes the "ใช้ค่ารวม (…)" hints too
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

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const global = collect(gInputs, GLOBAL_FIELDS)
    const values = collect(pInputs, [...PLANT_FIELDS, ...GLOBAL_FIELDS])
    finish()
    o.onSave(plantOf().id, values, global)
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
  setTab('global')
  dlg.showModal()
}

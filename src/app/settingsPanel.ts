import { resolve } from '../data/metrics'
import { withDefaults, type PlantSettings, type SettingsMap } from '../data/settings'
import type { Plant } from '../data/types'
import { confirmDialog } from './confirm'

/** Settings dialog: per-plant metadata and formula assumptions. A blank field = default / auto. */

export interface SettingsPanelOpts {
  plants: Plant[]
  settings: SettingsMap
  plantId: string
  displayName(p: Plant): string
  onSave(plantId: string, values: Partial<PlantSettings>): void
  onRemove(plantId: string): void
}

type Key = keyof PlantSettings
interface Field {
  key: Key
  label: string
  kind: 'text' | 'date' | 'number' | 'percent' // percent: shown ×100, stored as a fraction
  unit?: string
  step?: string
}

const FIELDS: Field[] = [
  { key: 'name', label: 'ชื่อที่แสดง', kind: 'text' },
  { key: 'startDate', label: 'วันเริ่มใช้งาน', kind: 'date' },
  { key: 'kWp', label: 'ขนาดติดตั้ง', kind: 'number', unit: 'kWp', step: '0.1' },
  { key: 'sunHours', label: 'ชั่วโมงแดดต่อวัน', kind: 'number', unit: 'ชม.', step: '0.1' },
  { key: 'performanceRatio', label: 'Performance Ratio', kind: 'percent', unit: '%', step: '1' },
  { key: 'peakTestKwhPerDay', label: 'Peak Test ต่อวัน', kind: 'number', unit: 'kWh', step: '0.1' },
  { key: 'peakTestFactor', label: 'Peak Test เทียบ Simulate', kind: 'percent', unit: '%', step: '1' },
  { key: 'abnormalBelow', label: 'ผิดปกติเมื่อ Efficiency ต่ำกว่า', kind: 'percent', unit: '%', step: '1' },
  { key: 'tariff', label: 'ค่าไฟ', kind: 'number', unit: '฿/kWh', step: '0.01' },
  { key: 'investment', label: 'เงินลงทุน', kind: 'number', unit: '฿', step: '1000' },
  { key: 'paybackPlanYears', label: 'แผนคืนทุน', kind: 'number', unit: 'ปี', step: '0.5' },
]

const round = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d)

function show(f: Field, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (f.kind === 'percent') return round(Number(v) * 100, 1)
  return String(v)
}

/** Grey hint text: what applies when the field is left blank. */
function hint(f: Field, plant: Plant, raw: Partial<PlantSettings>): string {
  const r = resolve(plant, withDefaults({ ...raw, [f.key]: undefined }))
  switch (f.key) {
    case 'name':
      return plant.id
    case 'kWp':
      return `อัตโนมัติ ≈ ${round(r.kWp, 1)}`
    case 'peakTestKwhPerDay':
      return `อัตโนมัติ ≈ ${round(r.peakTestKwhPerDay, 1)}`
    case 'investment':
      return `อัตโนมัติ ≈ ${Math.round(r.investment).toLocaleString('en-US')}`
    default:
      return show(f, withDefaults({})[f.key])
  }
}

function read(f: Field, input: HTMLInputElement): unknown {
  const t = input.value.trim()
  if (!t) return undefined
  if (f.kind === 'text' || f.kind === 'date') return t
  const n = Number(t)
  if (!Number.isFinite(n)) return undefined
  return f.kind === 'percent' ? n / 100 : n
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
  h.textContent = 'ตั้งค่า Plant'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = 'เว้นว่าง = ใช้ค่าเริ่มต้น/คำนวณอัตโนมัติ (ตัวเลขสีเทา) · บันทึกไว้ในเบราว์เซอร์นี้'

  const pick = document.createElement('select')
  pick.setAttribute('aria-label', 'เลือก Plant')
  for (const p of o.plants) pick.add(new Option(`${o.displayName(p)} (${p.id})`, p.id, false, p.id === o.plantId))
  const pickRow = document.createElement('label')
  pickRow.className = 'row'
  pickRow.append(Object.assign(document.createElement('span'), { textContent: 'Plant' }), pick)

  const grid = document.createElement('div')
  grid.className = 'fields'
  const inputs = new Map<Key, HTMLInputElement>()
  for (const f of FIELDS) {
    const row = document.createElement('label')
    row.className = 'row'
    const input = document.createElement('input')
    input.type = f.kind === 'percent' ? 'number' : f.kind
    if (f.step) input.step = f.step
    if (f.kind !== 'text' && f.kind !== 'date') input.min = '0'
    inputs.set(f.key, input)
    const unit = document.createElement('small')
    unit.textContent = f.unit ?? ''
    row.append(Object.assign(document.createElement('span'), { textContent: f.label }), input, unit)
    grid.append(row)
  }

  const plantOf = () => o.plants.find((p) => p.id === pick.value) ?? o.plants[0]
  const fill = () => {
    const plant = plantOf()
    const raw = o.settings[plant.id] ?? {}
    for (const f of FIELDS) {
      const input = inputs.get(f.key)!
      input.value = show(f, raw[f.key])
      input.placeholder = hint(f, plant, raw)
    }
  }
  pick.addEventListener('change', fill)

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
  btn('ลบ Plant นี้', 'danger', () => {
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
  btn('ล้างเป็นค่าเริ่มต้น', 'ghost', () => {
    for (const input of inputs.values()) input.value = ''
  })
  btn('ยกเลิก', 'ghost', () => finish())
  btn('บันทึก', 'primary', undefined, 'submit')

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const values: Partial<PlantSettings> = {}
    for (const f of FIELDS) {
      const v = read(f, inputs.get(f.key)!)
      if (v !== undefined) (values as Record<string, unknown>)[f.key] = v
    }
    // keep only what survives validation, so the stored map never holds junk
    const clean = withDefaults(values)
    const kept: Partial<PlantSettings> = {}
    for (const k of Object.keys(values) as Key[]) {
      if (clean[k] === values[k]) (kept as Record<string, unknown>)[k] = values[k]
    }
    finish()
    o.onSave(plantOf().id, kept)
  })
  // Esc closes the dialog natively; remove it on every close path
  dlg.addEventListener('close', () => finish())
  function finish(): void {
    if (dlg.open) dlg.close()
    dlg.remove()
    if (open === dlg) open = null
  }

  form.append(h, note, pickRow, grid, actions)
  dlg.append(form)
  document.body.append(dlg)
  fill()
  dlg.showModal()
}


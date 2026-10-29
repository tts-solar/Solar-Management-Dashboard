import type { DailyRow, DayProfile } from '../data/types'
import type { Resolved } from '../data/metrics'
import {
  advise,
  whatIf,
  DEFAULT_SOLAR_COST,
  DEFAULT_STORAGE_COST,
  type Verdict,
  type WhatIfParams,
} from '../data/advisor'
import { baht, energy, kpiCard, pct } from '../charts/common'

const HEADLINE: Record<Verdict, (size: number) => string> = {
  solar: (s) => `แนะนำ: เพิ่ม Solar ~${s} kW`,
  storage: (s) => `แนะนำ: เพิ่ม Energy Storage ~${s} kWh`,
  enough: () => 'เพียงพอแล้ว',
}

const num = (v: string): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A labelled number input for the what-if controls. */
function field(label: string, value: number, unit: string): HTMLElement {
  const row = document.createElement('label')
  row.className = 'whatif-field'
  const name = document.createElement('span')
  name.className = 'whatif-label'
  name.textContent = label
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '0'
  input.step = 'any'
  input.value = String(value)
  input.inputMode = 'decimal'
  const u = document.createElement('span')
  u.className = 'whatif-unit'
  u.textContent = unit
  row.append(name, input, u)
  return row
}

type CardTone = 'green' | 'yellow' | 'blue'

/** A grouped, color-toned KPI card holding one or more label/value(/sub) rows. */
function groupCard(tone: CardTone, rows: { label: string; value: string; sub?: string }[], wide = false): HTMLElement {
  const card = document.createElement('div')
  card.className = `kpi kpi-group is-${tone}${wide ? ' wide' : ''}`
  for (const r of rows) {
    const item = document.createElement('div')
    item.className = 'kpi-item'
    const add = (cls: string, text: string): void => {
      const d = document.createElement('div')
      d.className = cls
      d.textContent = text
      item.append(d)
    }
    add('label', r.label)
    add('value', r.value)
    if (r.sub) add('sub', r.sub)
    card.append(item)
  }
  return card
}

/**
 * The Solar vs Storage advisor card for one plant/period. `daily` is the already-filtered set of
 * days on screen, so the verdict reflects the period the user is looking at.
 */
export function advisorSection(daily: DailyRow[], r: Resolved, profile?: DayProfile): HTMLElement {
  const a = advise(daily, r, profile)

  const wrap = document.createElement('section')
  wrap.className = 'advisor-section'
  wrap.innerHTML = `
    <div class="advisor-rule"></div>
    <h2 class="panel-title">ตัวช่วยตัดสินใจลงทุนเพิ่ม <small>Solar vs Energy Storage</small></h2>
    <div class="advisor-badge is-${a.verdict}">
      <div class="verdict"></div>
      <div class="reason"></div>
    </div>
    <div class="advisor-body">
      <div class="advisor-support">
        <div class="support-title">ข้อมูลสนับสนุน <small>(เฉลี่ยต่อวัน · ${a.days} วัน)</small></div>
        <div class="kpis advisor-kpis" data-kpis></div>
      </div>
      <div class="whatif">
        <div class="support-title">ลองเพิ่มดู (What-if)</div>
        <div class="tabs whatif-tabs" role="tablist" data-whatif-tabs>
          <button type="button" role="tab" class="tab" data-mode="solar">Solar</button>
          <button type="button" role="tab" class="tab" data-mode="storage">Energy Storage</button>
        </div>
        <div class="whatif-fields" data-fields></div>
        <div class="kpis whatif-results" data-results></div>
      </div>
    </div>
    <p class="advisor-note" data-note></p>`

  wrap.querySelector<HTMLElement>('[data-note]')!.textContent = a.sizedFromProfile
    ? '* ขนาดแบตเตอรี่คำนวณจากโปรไฟล์ราย 15 นาที (จำลองการชาร์จ-จ่ายตามเวลาจริงของวันเฉลี่ย) จึงรวมผลของจังหวะไฟเหลือ/ไฟขาดในแต่ละช่วงเวลาแล้ว'
    : '* ประเมินจากพลังงานรวมต่อวัน (ไฟเหลือ/ซื้อไฟที่มิเตอร์บันทึก) ไม่ใช่โปรไฟล์รายชั่วโมง — ขนาดแบตเตอรี่เป็นค่าประมาณเบื้องต้น นำเข้าไฟล์ CSV ใหม่เพื่อให้ระบบอ่านโปรไฟล์ราย 15 นาทีและระบุขนาดได้แม่นขึ้น'

  wrap.querySelector<HTMLElement>('.verdict')!.textContent = HEADLINE[a.verdict](a.size)
  wrap.querySelector<HTMLElement>('.reason')!.textContent = a.reason

  // ── supporting numbers (answers "ขอข้อมูลสนับสนุน"), grouped into 3 color-coded cards:
  //    green = produce vs use · yellow = where the used power comes from · blue = surplus sold out ──
  const kpis = wrap.querySelector('[data-kpis]')!
  kpis.append(
    groupCard('green', [
      { label: 'ไฟที่ใช้ทั้งหมด', value: energy(a.avgConsumed), sub: '(ต่อวัน)' },
      { label: 'ไฟที่ผลิตได้', value: energy(a.avgProduced), sub: '(ต่อวัน)' },
    ]),
    groupCard('yellow', [
      { label: 'ซื้อไฟจากกริด', value: energy(a.avgImported), sub: '(ต่อวัน)' },
      { label: 'ใช้ไฟที่ผลิตเอง', value: pct(a.selfConsumption, 0), sub: `(พึ่งตัวเอง ${pct(a.selfSufficiency, 0)})` },
    ]),
    groupCard('blue', [{ label: 'ไฟเหลือขายออก', value: energy(a.avgExported), sub: '(ต่อวัน)' }], true),
  )
  // profile-only: how much is genuinely time-shiftable and the battery power the peak flow needs
  if (a.verdict === 'storage' && a.sizedFromProfile && a.powerKw !== null) {
    kpis.append(
      kpiCard('เก็บมาใช้ได้จริง', energy(a.shiftableKwh ?? 0), '(ต่อวัน · ตามจังหวะเวลา)'),
      kpiCard('กำลังแบตที่ควรมี', `${a.powerKw.toFixed(1)} kW`, '(จากช่วงที่ไฟไหลแรงสุด)'),
    )
  }

  // ── what-if controls ──
  const fields = wrap.querySelector('[data-fields]')!
  // a full-width caption that heads a group of fields, so the two kinds of lever read apart
  const groupLabel = (text: string): HTMLElement => {
    const d = document.createElement('div')
    d.className = 'whatif-group'
    d.textContent = text
    return d
  }
  // ใช้ไฟ/วัน is an adjustable scenario lever; ผลิตไฟ/วัน is a read-only READOUT (measured production +
  // the Solar add-on, filled in update()) so the user compares resulting generation against use. It is
  // NOT a lever — the calc keeps the measured production baseline, so the add-on is never counted twice.
  const baseProduced = field('ผลิตไฟ/วัน', Math.round(a.avgProduced), 'kWh')
  const baseProducedInput = baseProduced.querySelector('input')!
  baseProducedInput.readOnly = true
  baseProducedInput.tabIndex = -1
  baseProducedInput.classList.add('is-readout')
  const baseConsumed = field('ใช้ไฟ/วัน', Math.round(a.avgConsumed), 'kWh')
  // investment levers (cost money → drive payback)
  const solarKw = field('+ Solar', a.verdict === 'solar' ? a.size : 0, 'kW')
  const storageKwh = field('+ Energy Storage', a.verdict === 'storage' ? a.size : 0, 'kWh')
  const solarCost = field('ราคา Solar', DEFAULT_SOLAR_COST, '฿/kW')
  const storageCost = field('ราคา Energy Storage', DEFAULT_STORAGE_COST, '฿/kWh')
  // the solar pair and the storage pair sit next to each other so a tab can show/hide one pair cleanly
  fields.append(
    groupLabel('สถานการณ์ (ปรับดูได้)'),
    baseProduced,
    baseConsumed,
    groupLabel('ลงทุนเพิ่ม'),
    solarKw,
    solarCost,
    storageKwh,
    storageCost,
  )
  const input = (f: HTMLElement) => f.querySelector('input')!
  // Two tabs split the investment: the Solar tab shows only the solar pair, the Energy Storage tab only
  // the storage pair. The hidden pair is forced to 0 in the calc, so each tab's payback is that one
  // investment alone. The scenario levers (ผลิต/ใช้) stay shared, and every input keeps its value
  // across tab switches because the elements are only hidden, never removed.
  const solarFields = [solarKw, solarCost]
  const storageFields = [storageKwh, storageCost]
  let mode: 'solar' | 'storage' = a.verdict === 'storage' ? 'storage' : 'solar'

  const results = wrap.querySelector('[data-results]')!

  // caption under the fields: explains the ผลิตไฟ/วัน readout + the timing caveat (producing more than
  // you use does not mean zero grid-buy — production is midday, consumption is evening/night)
  const readoutNote = document.createElement('div')
  readoutNote.className = 'whatif-readout-note'
  readoutNote.textContent =
    '* "ผลิตไฟ/วัน" = ที่ผลิตเดิม + Solar ที่เพิ่ม · ผลิตมากกว่าใช้ ไม่ได้แปลว่าไม่ต้องซื้อไฟ (ผลิตกลางวัน/ใช้กลางคืน คนละเวลากัน)'
  fields.append(readoutNote)

  const update = (): void => {
    const addSolarKw = mode === 'solar' ? num(input(solarKw).value) : 0
    const p: WhatIfParams = {
      // ผลิตไฟ/วัน is a readout, not a lever — keep the measured production baseline so the Solar
      // add-on (below) is applied once, never double-counted from the field's own displayed total.
      baseProduced: a.avgProduced,
      baseConsumed: num(input(baseConsumed).value),
      addSolarKw,
      addStorageKwh: mode === 'storage' ? num(input(storageKwh).value) : 0,
      solarCostPerKw: num(input(solarCost).value),
      storageCostPerKwh: num(input(storageCost).value),
    }
    const w = whatIf(a, r, p)
    // fill the read-only ผลิตไฟ/วัน field with total production = measured + the Solar add-on
    // (the same newProduced whatIf derives internally)
    baseProducedInput.value = String(Math.round(a.avgProduced + addSolarKw * r.sunHours * r.performanceRatio))
    const payback = w.paybackYears === null ? '–' : `${w.paybackYears.toFixed(1)} ปี`
    results.replaceChildren(
      kpiCard('ใช้ไฟตัวเองใหม่', pct(w.newSelfConsumption, 0), `(เดิม ${pct(a.selfConsumption, 0)})`),
      kpiCard('ประหยัดค่าไฟ/ปี', baht(w.annualSaving)),
      kpiCard('เงินลงทุน', baht(w.addOnCost)),
      kpiCard('คืนทุน', payback, '(ประมาณ)'),
    )
  }

  // ── tabs: Solar | Energy Storage ──
  const tabButtons = [...wrap.querySelectorAll<HTMLButtonElement>('[data-whatif-tabs] .tab')]
  const setMode = (m: 'solar' | 'storage'): void => {
    mode = m
    for (const b of tabButtons) {
      const on = b.dataset.mode === m
      b.classList.toggle('on', on)
      b.setAttribute('aria-selected', String(on))
    }
    for (const f of solarFields) f.style.display = m === 'solar' ? '' : 'none'
    for (const f of storageFields) f.style.display = m === 'storage' ? '' : 'none'
    update()
  }
  for (const b of tabButtons) b.addEventListener('click', () => setMode(b.dataset.mode as 'solar' | 'storage'))

  for (const f of [baseProduced, baseConsumed, solarKw, storageKwh, solarCost, storageCost])
    input(f).addEventListener('input', update)
  setMode(mode) // initial render: apply the default tab's visibility + results

  return wrap
}

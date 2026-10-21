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

  // ── supporting numbers (answers "ขอข้อมูลสนับสนุน") ──
  wrap.querySelector('[data-kpis]')!.append(
    kpiCard('ไฟเหลือขายออก', energy(a.avgExported), '(ต่อวัน)'),
    kpiCard('ซื้อไฟจากกริด', energy(a.avgImported), '(ต่อวัน)'),
    kpiCard('ใช้ไฟที่ผลิตเอง', pct(a.selfConsumption, 0), `(พึ่งตัวเอง ${pct(a.selfSufficiency, 0)})`),
  )
  // profile-only: how much is genuinely time-shiftable and the battery power the peak flow needs
  if (a.verdict === 'storage' && a.sizedFromProfile && a.powerKw !== null) {
    wrap.querySelector('[data-kpis]')!.append(
      kpiCard('เก็บมาใช้ได้จริง', energy(a.shiftableKwh ?? 0), '(ต่อวัน · ตามจังหวะเวลา)'),
      kpiCard('กำลังแบตที่ควรมี', `${a.powerKw.toFixed(1)} kW`, '(จากช่วงที่ไฟไหลแรงสุด)'),
    )
  }

  // ── what-if controls ──
  const fields = wrap.querySelector('[data-fields]')!
  const solarKw = field('+ Solar', a.verdict === 'solar' ? a.size : 0, 'kW')
  const storageKwh = field('+ Energy Storage', a.verdict === 'storage' ? a.size : 0, 'kWh')
  const solarCost = field('ราคา Solar', DEFAULT_SOLAR_COST, '฿/kW')
  const storageCost = field('ราคา Energy Storage', DEFAULT_STORAGE_COST, '฿/kWh')
  fields.append(solarKw, storageKwh, solarCost, storageCost)
  const input = (f: HTMLElement) => f.querySelector('input')!

  const results = wrap.querySelector('[data-results]')!
  const update = (): void => {
    const p: WhatIfParams = {
      addSolarKw: num(input(solarKw).value),
      addStorageKwh: num(input(storageKwh).value),
      solarCostPerKw: num(input(solarCost).value),
      storageCostPerKwh: num(input(storageCost).value),
    }
    const w = whatIf(a, r, p)
    const payback = w.paybackYears === null ? '–' : `${w.paybackYears.toFixed(1)} ปี`
    results.replaceChildren(
      kpiCard('ใช้ไฟตัวเองใหม่', pct(w.newSelfConsumption, 0), `(เดิม ${pct(a.selfConsumption, 0)})`),
      kpiCard('ประหยัดค่าไฟ/ปี', baht(w.annualSaving)),
      kpiCard('เงินลงทุน', baht(w.addOnCost)),
      kpiCard('คืนทุน', payback, '(ประมาณ)'),
    )
  }
  for (const f of [solarKw, storageKwh, solarCost, storageCost]) input(f).addEventListener('input', update)
  update()

  return wrap
}

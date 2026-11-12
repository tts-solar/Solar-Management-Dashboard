import type { DailyRow, DayProfile } from '../data/types'
import type { Resolved } from '../data/metrics'
import {
  advise,
  headline,
  perPeriod,
  periodWord,
  whatIf,
  solarPerKwPerDay,
  DEFAULT_SOLAR_COST,
  DEFAULT_STORAGE_COST,
  type WhatIfParams,
} from '../data/advisor'
import { baht, energy, fmt0, kpiCard, pct } from '../charts/common'

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
 * The other side of a share: 7% self-sufficient → "93%". Every percentage in this view names its own
 * base in the label and its remainder here, because the two shares the advisor reports are measured
 * against DIFFERENT bases (one over what the plant produces, one over what it uses) and a bare pair
 * of numbers like "100%" and "7%" reads as a contradiction instead of two separate facts.
 */
const rest = (share: number | null): string => (share === null ? '–' : pct(1 - share, 0))

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
        <div class="support-title">ข้อมูลสนับสนุน <small>(${
          a.monthly ? `เฉลี่ยต่อเดือน · ${a.rows} เดือน` : `เฉลี่ยต่อวัน · ${a.days} วัน`
        })</small></div>
        <div class="kpis advisor-kpis" data-kpis></div>
      </div>
      <div class="whatif">
        <div class="support-title">ลองเพิ่มดู (What-if)</div>
        <div class="tabs whatif-tabs" role="tablist" data-whatif-tabs>
          <button type="button" role="tab" class="tab" data-mode="solar">Solar</button>
          <button type="button" role="tab" class="tab" data-mode="storage">Energy Storage</button>
        </div>
        <div class="whatif-warn" data-whatif-warn hidden>
          ⚠ ข้อมูลรายเดือนบอกไม่ได้ว่าไฟเหลือกับไฟที่ต้องซื้อเกิดขึ้น "คนละเวลากัน" หรือไม่ ซึ่งเป็นหัวใจของการคิดขนาดแบตเตอรี่ — ตัวเลขฝั่งนี้จึงเป็นภาพคร่าว ๆ ให้ลองเล่นดูเท่านั้น ไม่ควรใช้ตัดสินใจสั่งซื้อ
        </div>
        <div class="whatif-fields" data-fields></div>
        <div class="kpis whatif-results" data-results></div>
      </div>
    </div>
    <p class="advisor-note" data-note></p>`

  const notes = [
    '* "ไม่เกิน" = ดีที่สุดเท่าที่เป็นไปได้ ของจริงต่ำกว่านี้ เพราะไฟที่ผลิตกับไฟที่ใช้เกิดคนละเวลากัน (ผลิตกลางวัน/ใช้กลางคืน)',
    a.sizedFromProfile
      ? '* ขนาดแบตเตอรี่คำนวณจากโปรไฟล์ราย 15 นาที (จำลองการชาร์จ-จ่ายตามเวลาจริงของวันเฉลี่ย) จึงรวมผลของจังหวะไฟเหลือ/ไฟขาดในแต่ละช่วงเวลาแล้ว'
      : '* ประเมินจากพลังงานรวมต่อวัน (ไฟเหลือ/ซื้อไฟที่มิเตอร์บันทึก) ไม่ใช่โปรไฟล์รายชั่วโมง — ขนาดแบตเตอรี่เป็นค่าประมาณเบื้องต้น นำเข้าไฟล์ CSV ใหม่เพื่อให้ระบบอ่านโปรไฟล์ราย 15 นาทีและระบุขนาดได้แม่นขึ้น',
  ]
  // The figures above are now stated per month, which is the resolution the file really has. The
  // MODEL underneath still works a day at a time, so it necessarily assumes every day of a month
  // looks like the month's average — say that, because it is the limit of what monthly data can tell.
  if (a.monthly)
    notes.push(
      '* ข้อมูลชุดนี้เป็นรายงานรายเดือน ตัวเลขจึงเป็นยอดรวมต่อเดือน — การประเมินภายในเฉลี่ยทุกวันในเดือนให้เท่ากัน ทั้งที่จริงแต่ละวันใช้ไฟไม่เท่ากัน ผลที่ได้จึงเป็นภาพรวม ไม่ใช่ค่าที่จะเกิดขึ้นจริงทุกวัน และขนาด Energy Storage เป็นเพียงค่าประมาณหยาบ',
    )
  wrap.querySelector<HTMLElement>('[data-note]')!.textContent = notes.join(' ')

  wrap.querySelector<HTMLElement>('.verdict')!.textContent = headline(a)
  wrap.querySelector<HTMLElement>('.reason')!.textContent = a.reason

  // ── supporting numbers (answers "ขอข้อมูลสนับสนุน"), grouped into 3 color-coded cards:
  //    green = produce vs use · yellow = where the used power comes from · blue = surplus sold out ──
  const kpis = wrap.querySelector('[data-kpis]')!
  // energies are reported on the source's own basis; the per-period caption says which it is. The
  // shares below are ratios of two figures on the SAME basis, so they read the same either way.
  const per = `(ต่อ${periodWord(a)})`
  const amount = (perDay: number): string => energy(perPeriod(a, perDay))
  kpis.append(
    groupCard('green', [
      { label: 'ไฟที่ใช้ทั้งหมด', value: amount(a.avgConsumed), sub: per },
      { label: 'ไฟที่ผลิตได้', value: amount(a.avgProduced), sub: per },
    ]),
    groupCard('yellow', [
      { label: 'ซื้อไฟจากกริด', value: amount(a.avgImported), sub: per },
      // base = everything the plant USES; the kWh above it is the remainder this sub-line names
      { label: 'ไฟที่ใช้ มาจากแผงเอง', value: pct(a.selfSufficiency, 0), sub: `(อีก ${rest(a.selfSufficiency)} ซื้อจากกริด)` },
    ]),
    // base = everything the plant PRODUCES. With nothing exported this share is 100% by definition
    // and says exactly what the kWh beside it already says, so it is left out rather than printed as
    // a second, contradictory-looking percentage.
    groupCard(
      'blue',
      [
        { label: 'ไฟเหลือขายออก', value: amount(a.avgExported), sub: per },
        ...(a.avgExported > 0
          ? [{ label: 'ไฟที่ผลิตได้ ใช้เอง', value: pct(a.selfConsumption, 0), sub: `(อีก ${rest(a.selfConsumption)} ขายออก)` }]
          : []),
      ],
      true,
    ),
  )
  // profile-only: how much is genuinely time-shiftable and the battery power the peak flow needs
  if (a.verdict === 'storage' && a.sizedFromProfile && a.powerKw !== null) {
    kpis.append(
      kpiCard('เก็บมาใช้ได้จริง', amount(a.shiftableKwh ?? 0), `(ต่อ${periodWord(a)} · ตามจังหวะเวลา)`),
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
  // the one real scenario lever, typed and shown on the source's own basis (per month for a monthly
  // report); update() divides it back to per-day before the calc, which works in days throughout
  const baseConsumed = field(`ใช้ไฟ/${periodWord(a)}`, Math.round(perPeriod(a, a.avgConsumed)), 'kWh')
  // investment levers (cost money → drive payback)
  const solarKw = field('+ Solar', a.verdict === 'solar' ? a.size : 0, 'kW')
  // Resulting production rides on the + Solar row rather than standing in the scenario group above:
  // it is what that very input produces (measured output + the add-on), so cause and effect belong on
  // one line. It is a READOUT, never a lever — the calc keeps the measured production baseline, so
  // the add-on is counted once. Being part of the row, it also hides with it on the Storage tab,
  // where a battery changes nothing about how much the plant generates.
  const producedOut = document.createElement('span')
  producedOut.className = 'whatif-readout'
  solarKw.append(producedOut)
  const storageKwh = field('+ Energy Storage', a.verdict === 'storage' ? a.size : 0, 'kWh')
  const solarCost = field('ราคา Solar', DEFAULT_SOLAR_COST, '฿/kW')
  const storageCost = field('ราคา Energy Storage', DEFAULT_STORAGE_COST, '฿/kWh')
  // the solar pair and the storage pair sit next to each other so a tab can show/hide one pair cleanly
  fields.append(
    groupLabel('สถานการณ์ (ปรับดูได้)'),
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
  // shown on the Energy Storage tab only, and only for monthly data: sizing a battery is a question
  // about timing, which a month's totals cannot answer (see headline() in advisor.ts)
  const storageWarn = wrap.querySelector<HTMLElement>('[data-whatif-warn]')!

  // caption under the fields: explains the production readout + the timing caveat (producing more
  // than you use does not mean zero grid-buy — production is midday, consumption is evening/night)
  const readoutNote = document.createElement('div')
  readoutNote.className = 'whatif-readout-note'
  readoutNote.textContent =
    '* ตัวเลขหลังลูกศร = ไฟที่ผลิตเดิม + Solar ที่เพิ่ม · ผลิตมากกว่าใช้ ไม่ได้แปลว่าไม่ต้องซื้อไฟ (ผลิตกลางวัน/ใช้กลางคืน คนละเวลากัน)'
  fields.append(readoutNote)

  const update = (): void => {
    const addSolarKw = mode === 'solar' ? num(input(solarKw).value) : 0
    const p: WhatIfParams = {
      // production is a readout, not a lever — keep the measured baseline so the Solar add-on
      // (below) is applied once, never double-counted from the readout's own displayed total.
      baseProduced: a.avgProduced,
      // typed on the row's basis (kWh per month for a monthly report) → back to per day for the calc
      baseConsumed: num(input(baseConsumed).value) / a.perRowDays,
      addSolarKw,
      addStorageKwh: mode === 'storage' ? num(input(storageKwh).value) : 0,
      solarCostPerKw: num(input(solarCost).value),
      storageCostPerKwh: num(input(storageCost).value),
    }
    const w = whatIf(a, r, p)
    // the readout beside + Solar: total production = measured + the add-on (the same newProduced
    // whatIf derives internally)
    producedOut.textContent = `→ ${fmt0(Math.round(perPeriod(a, a.avgProduced + addSolarKw * solarPerKwPerDay(r))))} kWh/${periodWord(a)}`
    const payback = w.paybackYears === null ? '–' : `${w.paybackYears.toFixed(1)} ปี`
    // Each share is shown as before → after, so the card answers "what does this buy me" in one line
    // instead of printing a lone new number whose base the reader has to guess. With nothing added
    // there is no journey to show, so it falls back to the single measured value.
    const added = addSolarKw > 0 || p.addStorageKwh > 0
    // One share only, the one the money below it comes from: every kWh this panel stops buying is a
    // kWh of saving. The other share (how much of its own output the plant uses rather than sells)
    // is a fact about the plant, not about the investment, and the support cards on the left already
    // report it — repeating it here mostly produced lines like "100% → 100%".
    //
    // The projected share carries "ไม่เกิน" because it is a CEILING, not a forecast: the model lets
    // any kWh generated in a period displace any kWh bought in that same period, while in reality
    // the sun is on at midday and the load runs in the evening. The figure before the arrow is
    // measured and needs no such hedge, which is why an untouched scenario shows it bare.
    results.replaceChildren(
      kpiCard(
        'ไฟที่ใช้ มาจากแผงเอง',
        added ? `${pct(a.selfSufficiency, 0)} → ไม่เกิน ${pct(w.newSelfSufficiency, 0)}` : pct(a.selfSufficiency, 0),
        added ? '(ก่อน → หลังเพิ่ม)' : '(ตอนนี้)',
      ),
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
    readoutNote.style.display = m === 'solar' ? '' : 'none' // it explains the + Solar row's readout
    storageWarn.hidden = !(m === 'storage' && a.monthly)
    update()
  }
  for (const b of tabButtons) b.addEventListener('click', () => setMode(b.dataset.mode as 'solar' | 'storage'))

  for (const f of [baseConsumed, solarKw, storageKwh, solarCost, storageCost])
    input(f).addEventListener('input', update)
  setMode(mode) // initial render: apply the default tab's visibility + results

  return wrap
}

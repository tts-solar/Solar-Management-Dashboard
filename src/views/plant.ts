import type { Chart } from 'chart.js'
import { inPeriod, sumRows, toMonthly } from '../data/aggregate'
import { bep, formatYM, resolve, withMetrics, type BepYear, type MetricRow } from '../data/metrics'
import { settingsFor } from '../data/settings'
import type { Plant } from '../data/types'
import { C, MONTHS, axisTitle, chartLegend, energy, energyScale, kpiCard, mountChart, pct } from '../charts/common'
import { bepChart, bepLegend } from '../charts/bep'
import { scatterChart } from '../charts/scatter'
import { dataTable } from './table'
import { openAdvisorDialog } from '../app/advisorDialog'
import type { ViewCtx } from './overview'

/** One view for design p3–p6: a year (rows = months) or a month (rows = days). */

type Tab = 'bep' | 'table'
let tab: Tab = 'bep' // remembered while moving between plants/periods

interface Row {
  key: string
  axis: string // x-axis label
  label: string // table / tooltip label
  m: MetricRow
}

export function renderPlant(el: HTMLElement, ctx: ViewCtx, plant: Plant, year: string, month?: string): void {
  const daily = inPeriod(plant.daily, month ? `${year}-${month}` : year)
  if (!daily.length) {
    el.innerHTML = '<div class="empty">ไม่มีข้อมูลในช่วงนี้</div>'
    return
  }
  const r = resolve(plant, settingsFor(ctx.settings, plant.id))
  const rows: Row[] = month
    ? daily.map((d) => {
        const [y, mo, day] = d.date.split('-')
        return { key: d.date, axis: `${MONTHS[+mo - 1]} ${+day}`, label: `${day}/${mo}/${y}`, m: withMetrics(d, r) }
      })
    : toMonthly(daily).map((p) => {
        const name = MONTHS[+p.key.slice(5) - 1]
        return { key: p.key, axis: name, label: `${name} ${year}`, m: withMetrics(p, r, inPeriod(daily, p.key)) }
      })
  const total = withMetrics(sumRows(daily), r, daily)
  // year view: a month is clickable and opens its daily view
  const drill = month ? undefined : (key: string) => ctx.open({ view: 'plant', plant: plant.id, year, month: key.slice(5) })

  el.innerHTML = `
    <div class="page">
      <section class="cell left">
        <h2 class="panel-title">Production Overview</h2>
        <div class="chart-col"><div class="chart-box" data-chart="line"></div></div>
      </section>
      <section class="cell right"><div class="kpis" data-kpis></div></section>
      <div class="rule"></div>
    </div>
    <div class="page bottom">
      <section class="cell left">
        <h2 class="panel-title">Efficiency and Consumption</h2>
        <div class="chart-col"><div class="chart-box" data-chart="scatter"></div></div>
      </section>
      <section class="cell right">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" data-tab="bep">Break-Even Point (BEP)</button>
          <button type="button" role="tab" class="tab" data-tab="table">Data table</button>
        </div>
        <div class="tab-panel" role="tabpanel" data-panel></div>
      </section>
    </div>`
  const box = (name: string) => el.querySelector<HTMLElement>(`[data-chart="${name}"]`)!

  // ── Consumer / Simulate / Peak Test / Production per period ──
  const scale = energyScale(Math.max(...rows.flatMap((x) => [x.m.consumed, x.m.simulate, x.m.peakTest, x.m.produced])))
  const series = (label: string, key: 'consumed' | 'simulate' | 'peakTest' | 'produced', color: string) => ({
    label,
    data: rows.map((x) => x.m[key] / scale.div),
    borderColor: color,
    backgroundColor: color,
    borderWidth: month ? 2 : 3,
    pointRadius: month ? 2.5 : 5,
    tension: 0.15,
  })
  const lineBox = box('line')
  lineBox.setAttribute('role', 'img')
  lineBox.setAttribute('aria-label', `Consumption, plan, peak test and production per ${month ? 'day' : 'month'}`)
  mountChart(lineBox, {
    type: 'line',
    data: {
      labels: rows.map((x) => x.axis),
      datasets: [
        series('Consumer', 'consumed', C.ink),
        series('Simulate', 'simulate', C.blue),
        series('Peak Test', 'peakTest', '#a6a6a6'),
        series('Production', 'produced', C.amber),
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, title: axisTitle(`Production (${scale.unit})`), grid: { display: false } },
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => rows[items[0]?.dataIndex]?.label ?? '',
            label: (c) => `${c.dataset.label}: ${energy(Number(c.raw) * scale.div)}`,
            footer: () => (drill ? 'คลิกเพื่อดูรายวัน' : ''),
          },
        },
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | undefined
        if (t && drill) t.style.cursor = els.length ? 'pointer' : 'default'
      },
      onClick: (_e, els) => {
        if (drill && els.length) drill(rows[els[0].index].key)
      },
    },
  })
  lineBox.after(
    chartLegend([
      { label: 'Consumer', color: C.ink },
      { label: 'Simulate', color: C.blue },
      { label: 'Peak Test', color: C.gray },
      { label: 'Production', color: C.amber },
    ]),
  )

  // ── KPI cards ──
  el.querySelector('[data-kpis]')!.append(
    kpiCard('Total Production', energy(total.produced), `(Plan : ${energy(total.simulate)})`, true),
    kpiCard('Production Efficiency', pct(total.efficiency, 0)),
    kpiCard('Used Cover Rate', pct(total.coverRate, 0), `(Consume : ${energy(total.consumed)})`),
  )

  // ── efficiency vs consumption ──
  const zoneText = month ? 'วันที่อาจทำงานผิดปกติ' : 'เดือนที่อาจทำงานผิดปกติ'
  scatterChart(
    box('scatter'),
    rows
      .filter((x) => x.m.efficiency !== null)
      .map((x) => ({ key: x.key, label: x.label, consumed: x.m.consumed, efficiency: x.m.efficiency!, abnormal: x.m.abnormal })),
    { abnormalBelow: r.abnormalBelow, onClick: drill },
  )
  box('scatter').after(
    chartLegend([
      { label: zoneText, color: C.bad },
      { label: 'ปกติ', color: '#4d4d4d' },
    ]),
  )

  // ── tabs: BEP | Data table ──
  const panel = el.querySelector<HTMLElement>('[data-panel]')!
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-tab]')]
  let bepInstance: Chart | undefined
  const show = (t: Tab) => {
    tab = t
    for (const b of buttons) {
      const on = b.dataset.tab === t
      b.classList.toggle('on', on)
      b.setAttribute('aria-selected', String(on))
    }
    bepInstance?.destroy() // destroying twice (again in destroyCharts) is a no-op
    bepInstance = undefined
    if (t === 'table') return panel.replaceChildren(tablePanel())
    const { node, chartBox, years } = bepPanel()
    panel.replaceChildren(node)
    bepInstance = bepChart(chartBox, years) // needs the laid-out box
  }
  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab as Tab))

  function tablePanel(): HTMLElement {
    const list = rows.map((x) => ({ key: x.key, label: month ? x.label : x.axis, ...pick(x.m) }))
    return dataTable(list, pick(total), !!month, drill)
  }

  function bepPanel(): { node: HTMLElement; chartBox: HTMLElement; years: BepYear[] } {
    const b = bep(plant, r)
    const wrap = document.createElement('div')
    wrap.className = 'bep'
    const chartCol = document.createElement('div')
    chartCol.className = 'chart-col'
    const chartBox = document.createElement('div')
    chartBox.className = 'chart-box'
    if (b.years.some((y) => y.projected)) {
      const note = document.createElement('div')
      note.className = 'chart-note'
      note.textContent = 'เส้นประ = ประมาณการ'
      chartBox.append(note)
    }
    chartCol.append(chartBox, bepLegend()) // D3: pill legend sits below the chart
    const cards = document.createElement('div')
    cards.className = 'kpis bep-cards'
    // D1: BEP card sub-line is English-only — "Plan N Years" (no Thai estimate/no-investment note).
    const bepValue = b.bepYears === null ? '–' : formatYM(b.bepYears)
    const bepSub = `Plan ${b.planYears} Years`
    // D2: forecast card — fixed "คาดการณ์" header; the value leads with ช้า/เร็ว; faster = default (green),
    // slower = red background (.slow); a parenthesis sub-line shows the gap vs plan in ปี/เดือน.
    const speed =
      b.fasterPct === null
        ? kpiCard('คาดการณ์', '–')
        : kpiCard(
            'คาดการณ์',
            `${b.fasterPct >= 0 ? 'เร็ว' : 'ช้า'} ${Math.abs(b.fasterPct).toFixed(2)}%`,
            `(${formatYM(Math.abs(b.planYears - b.bepYears!))})`,
          )
    if (b.fasterPct !== null && b.fasterPct < 0) speed.classList.add('slow')
    // a full-width advisor trigger sits at the top of the BEP cards column (above Plant Age)
    const advisorBtn = document.createElement('button')
    advisorBtn.type = 'button'
    advisorBtn.className = 'advisor-trigger'
    advisorBtn.textContent = 'คำแนะนำลงทุน'
    advisorBtn.setAttribute('aria-label', 'เปิดตัวช่วยตัดสินใจลงทุนเพิ่ม Solar vs Energy Storage')
    advisorBtn.addEventListener('click', () => openAdvisorDialog(daily, r, plant.profile))
    cards.append(advisorBtn, kpiCard('Plant Age (Year)', formatYM(b.ageYears)), kpiCard('BEP (Year)', bepValue, bepSub), speed)
    wrap.append(chartCol, cards)
    return { node: wrap, chartBox, years: b.years }
  }

  show(tab)
}

const pick = (m: Pick<MetricRow, 'consumed' | 'produced' | 'efficiency' | 'abnormal'>) => ({
  consumed: m.consumed,
  produced: m.produced,
  efficiency: m.efficiency,
  abnormal: m.abnormal,
})

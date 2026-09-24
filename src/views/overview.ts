import { inPeriod, monthsOf, sumRows } from '../data/aggregate'
import { ageYears, cumulative, resolve, withMetrics, type MetricRow, type Resolved } from '../data/metrics'
import { settingsFor, type SettingsMap } from '../data/settings'
import type { Plant } from '../data/types'
import type { Route } from '../app/router'
import { C, MONTHS, axisTitle, energy, energyScale, kpiCard, mountChart, pct, pillLabels, type PillSpec } from '../charts/common'
import { bubbleChart } from '../charts/bubble'
import { treemapChart } from '../charts/treemap'

export interface ViewCtx {
  plants: Plant[]
  settings: SettingsMap
  displayName(p: Plant): string
  open(route: Route): void
}

/** Age (years) past which a low-efficiency plant is flagged "consider re-investing" — about half a 25-year panel life. */
export const REINVEST_AGE = 12.5

interface PlantYear {
  plant: Plant
  r: Resolved
  total: MetricRow
  lastDate: string
}

export function renderOverview(el: HTMLElement, ctx: ViewCtx, year: string): void {
  const rows: PlantYear[] = []
  for (const plant of ctx.plants) {
    const daily = inPeriod(plant.daily, year)
    if (!daily.length) continue
    const r = resolve(plant, settingsFor(ctx.settings, plant.id))
    rows.push({ plant, r, total: withMetrics(sumRows(daily), r), lastDate: daily[daily.length - 1].date })
  }
  if (!rows.length) {
    el.innerHTML = '<div class="empty">ยังไม่มีข้อมูลของปีนี้ — นำเข้าไฟล์ CSV ของ Plant ได้จากปุ่มด้านบน</div>'
    return
  }

  el.innerHTML = `
    <div class="page">
      <section class="cell left">
        <h2 class="panel-title">Production Overview</h2>
        <div class="chart-box" data-chart="line"></div>
      </section>
      <section class="cell right"><div class="kpis" data-kpis></div></section>
      <div class="rule"></div>
      <section class="cell left">
        <h2 class="panel-title">Efficiency and Age Relationship</h2>
        <div class="chart-box" data-chart="bubble"><div class="chart-note">● : Plants<br>Size : Capacity</div></div>
      </section>
      <section class="cell right">
        <h2 class="panel-title">Project Plants <small>(Sort by Production Rate)</small></h2>
        <div class="chart-box" data-chart="treemap"></div>
      </section>
    </div>`
  const box = (name: string) => el.querySelector<HTMLElement>(`[data-chart="${name}"]`)!
  const open = (id: string) => ctx.open({ view: 'plant', plant: id, year })

  // ── cumulative monthly lines, all plants together ──
  const months = [...new Set(rows.flatMap((x) => monthsOf(x.plant.daily, year)))].sort()
  const perMonth = months.map((m) => {
    let produced = 0
    let consumed = 0
    let simulate = 0
    for (const x of rows) {
      const t = withMetrics(sumRows(inPeriod(x.plant.daily, m)), x.r)
      produced += t.produced
      consumed += t.consumed
      simulate += t.simulate
    }
    return { produced, consumed, simulate }
  })
  const cum = {
    consumed: cumulative(perMonth.map((v) => v.consumed)),
    simulate: cumulative(perMonth.map((v) => v.simulate)),
    produced: cumulative(perMonth.map((v) => v.produced)),
  }
  const scale = energyScale(Math.max(...cum.consumed, ...cum.simulate, ...cum.produced))
  const series = (label: string, values: number[], color: string, pill: PillSpec) => ({
    label,
    data: values.map((v) => v / scale.div),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    pointRadius: 5,
    tension: 0.25,
    pill,
  })
  const lineBox = box('line')
  lineBox.setAttribute('role', 'img')
  lineBox.setAttribute('aria-label', 'Cumulative consumption, plan and production by month')
  mountChart(lineBox, {
    type: 'line',
    data: {
      labels: months.map((m) => MONTHS[+m.slice(5) - 1]),
      datasets: [
        series('Consumer', cum.consumed, C.ink, { at: 0.3, dy: -26 }),
        series('Simulate', cum.simulate, C.blue, { at: 0.55, dy: -24 }),
        series('Production', cum.produced, C.amber, { at: 0.8, dy: 26, color: C.ink }),
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, title: axisTitle(`Production (${scale.unit})`), grid: { display: false } },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${energy(Number(c.raw) * scale.div)} (สะสม)` } },
      },
    },
    plugins: [pillLabels],
  })

  // ── KPI cards ──
  const sum = (k: 'produced' | 'consumed' | 'simulate') => rows.reduce((s, x) => s + x.total[k], 0)
  const produced = sum('produced')
  const consumed = sum('consumed')
  const simulate = sum('simulate')
  el.querySelector('[data-kpis]')!.append(
    kpiCard('Total Production', energy(produced), `(Plan : ${energy(simulate)})`, true),
    kpiCard('Production Efficiency', pct(simulate > 0 ? produced / simulate : null, 0)),
    kpiCard('Used Cover Rate', pct(consumed > 0 ? produced / consumed : null, 0), `(Consume : ${energy(consumed)})`),
  )

  // ── efficiency vs age ──
  const effSplit = rows.reduce((m, x) => m + x.r.abnormalBelow, 0) / rows.length
  bubbleChart(
    box('bubble'),
    rows
      .filter((x) => x.total.efficiency !== null)
      .map((x) => ({
        id: x.plant.id,
        name: ctx.displayName(x.plant),
        efficiency: x.total.efficiency!,
        age: ageYears(x.r.startDate, x.lastDate),
        kWp: x.r.kWp,
      })),
    { effSplit, ageSplit: REINVEST_AGE, onClick: open },
  )

  // ── plants treemap ──
  treemapChart(
    box('treemap'),
    rows.map((x) => ({
      id: x.plant.id,
      name: ctx.displayName(x.plant),
      produced: x.total.produced,
      efficiency: x.total.efficiency,
      abnormal: x.total.abnormal,
    })),
    open,
  )
}

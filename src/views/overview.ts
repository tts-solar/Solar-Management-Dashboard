import { inPeriod, inRange, monthsOf, rangeIsDaily, sumRows, yearOf } from '../data/aggregate'
import { ageYears, cumulative, resolve, withMetrics, type MetricRow, type Resolved } from '../data/metrics'
import { globalSettings, settingsFor, type SettingsMap } from '../data/settings'
import type { Plant } from '../data/types'
import type { Route } from '../app/router'
import { C, MONTHS, axisTitle, chartLegend, energy, energyScale, kpiCard, mountChart, pct } from '../charts/common'
import { bubbleChart, bubbleLegend } from '../charts/bubble'
import { treemapChart } from '../charts/treemap'

export interface ViewCtx {
  plants: Plant[]
  settings: SettingsMap
  displayName(p: Plant): string
  open(route: Route): void
}

interface PlantYear {
  plant: Plant
  r: Resolved
  total: MetricRow
  lastDate: string
}

export interface DateRange {
  start: string
  end: string
}

export function renderOverview(el: HTMLElement, ctx: ViewCtx, year: string, range?: DateRange): void {
  // one plant's rows for the active filter: a custom date range, else the whole selected year
  const scoped = (plant: Plant): ReturnType<typeof inPeriod> =>
    range ? inRange(plant.daily, range.start, range.end) : inPeriod(plant.daily, year)

  const rows: PlantYear[] = []
  for (const plant of ctx.plants) {
    const daily = scoped(plant)
    if (!daily.length) continue
    const r = resolve(plant, settingsFor(ctx.settings, plant.id))
    // year view uses the calendar-day plan basis (a missing day is a shortfall); a custom range uses
    // its selected data days only, so a part-month selection is not charged the whole month's plan
    rows.push({ plant, r, total: withMetrics(sumRows(daily), r, daily, !range), lastDate: daily[daily.length - 1].date })
  }
  if (!rows.length) {
    const msg = range
      ? 'ยังไม่มีข้อมูลในช่วงวันที่เลือก — ลองขยายช่วง หรือนำเข้าไฟล์ CSV เพิ่ม'
      : 'ยังไม่มีข้อมูลของปีนี้ — นำเข้าไฟล์ CSV ของ Plant ได้จากปุ่มด้านบน'
    el.innerHTML = `<div class="empty">${msg}</div>`
    return
  }

  el.innerHTML = `
    <div class="page">
      <section class="cell left">
        <h2 class="panel-title">Production Overview</h2>
        <div class="chart-col"><div class="chart-box" data-chart="line"></div></div>
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
  // clicking a plant keeps the active filter: carry the range (anchored to a year the plant route needs)
  const open = (id: string) =>
    ctx.open(
      range
        ? { view: 'plant', plant: id, year: yearOf(range.start), start: range.start, end: range.end }
        : { view: 'plant', plant: id, year },
    )

  // ── cumulative lines, all plants together ──
  // buckets = months of the selected year; or (range) one point per day for a short span, else per month
  const dayBuckets = !!range && rangeIsDaily(range.start, range.end)
  const bucketKeys = range
    ? dayBuckets
      ? [...new Set(rows.flatMap((x) => scoped(x.plant).map((d) => d.date)))].sort()
      : [...new Set(rows.flatMap((x) => monthsOf(scoped(x.plant))))].sort()
    : [...new Set(rows.flatMap((x) => monthsOf(x.plant.daily, year)))].sort()
  const bucketLabel = (k: string): string =>
    dayBuckets ? `${+k.slice(8, 10)}/${+k.slice(5, 7)}` : MONTHS[+k.slice(5) - 1]
  const perMonth = bucketKeys.map((key) => {
    let produced = 0
    let consumed = 0
    let simulate = 0
    for (const x of rows) {
      const pd = inPeriod(x.plant.daily, key)
      if (dayBuckets) {
        // a day bucket holds one row per plant: plan is the per-day figure (calendar mode would
        // charge a whole month's plan to a single day)
        for (const d of pd) {
          const m = withMetrics(d, x.r)
          produced += m.produced
          consumed += m.consumed
          simulate += m.simulate
        }
      } else {
        const t = withMetrics(sumRows(pd), x.r, pd, !range)
        produced += t.produced
        consumed += t.consumed
        simulate += t.simulate
      }
    }
    return { produced, consumed, simulate }
  })
  const cum = {
    consumed: cumulative(perMonth.map((v) => v.consumed)),
    simulate: cumulative(perMonth.map((v) => v.simulate)),
    produced: cumulative(perMonth.map((v) => v.produced)),
  }
  const scale = energyScale(Math.max(...cum.consumed, ...cum.simulate, ...cum.produced))
  const series = (label: string, values: number[], color: string) => ({
    label,
    data: values.map((v) => v / scale.div),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    pointRadius: 5,
    tension: 0.25,
  })
  const lineBox = box('line')
  lineBox.setAttribute('role', 'img')
  lineBox.setAttribute('aria-label', `Cumulative consumption, plan and production by ${dayBuckets ? 'day' : 'month'}`)
  mountChart(lineBox, {
    type: 'line',
    data: {
      labels: bucketKeys.map(bucketLabel),
      datasets: [
        series('Consumer', cum.consumed, C.ink),
        series('Simulate', cum.simulate, C.blue),
        series('Production', cum.produced, C.amber),
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
  })
  lineBox.after(
    chartLegend([
      { label: 'Consumer', color: C.ink },
      { label: 'Simulate', color: C.blue },
      { label: 'Production', color: C.amber },
    ]),
  )

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
  // the dashed "Age of Plant" split line is a global-only setting (same value for every plant)
  const reinvestAge = globalSettings(ctx.settings).reinvestAge
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
    { effSplit, ageSplit: reinvestAge, onClick: open },
  )
  box('bubble').after(bubbleLegend())

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

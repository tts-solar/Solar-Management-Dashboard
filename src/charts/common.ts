import { Chart, type ChartConfiguration, type ChartType } from 'chart.js'

/** Palette shared with styles.css (Canva design). */
export const C = {
  green: '#17594a',
  amber: '#f2a93b',
  ink: '#111111',
  gray: '#595959',
  blue: '#0f4fa8',
  ok: '#1e9e5a',
  bad: '#c00000',
  line: '#d8dfdc',
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const N0 = nf(0)
const N1 = nf(1)

export const fmt0 = (n: number): string => N0.format(n)
export const fmt1 = (n: number): string => N1.format(n)
export const pct = (fraction: number | null, digits = 1): string =>
  fraction === null ? '–' : `${nf(digits).format(fraction * 100)}%`

/** Energy with a unit that keeps the number short: 85,792 kWh · 200.4 MWh · 1.2 GWh. */
export function energy(kwh: number): string {
  const a = Math.abs(kwh)
  if (a >= 1e6) return `${fmt1(kwh / 1e6)} GWh`
  if (a >= 1e5) return `${fmt1(kwh / 1e3)} MWh`
  return `${fmt0(kwh)} kWh`
}

/** Pick one axis unit for a whole series so every point is scaled the same way. */
export function energyScale(maxKwh: number): { unit: string; div: number } {
  if (maxKwh >= 1e6) return { unit: 'GWh', div: 1e6 }
  if (maxKwh >= 1e4) return { unit: 'MWh', div: 1e3 }
  return { unit: 'kWh', div: 1 }
}

export const baht = (n: number): string => `${fmt0(n)} ฿`

/** Create a chart in a fresh canvas inside `box`; charts are tracked so a re-render frees them. */
const live = new Set<Chart>()
export function mountChart<T extends ChartType>(box: HTMLElement, config: ChartConfiguration<T>): Chart<T> {
  const canvas = document.createElement('canvas')
  box.querySelectorAll('canvas').forEach((c) => c.remove()) // keep overlays such as .chart-note
  box.append(canvas)
  const chart = new Chart(canvas, config)
  for (const c of live) if (!c.canvas) live.delete(c) // drop charts destroyed elsewhere (e.g. a tab switch)
  live.add(chart as unknown as Chart)
  return chart
}
export function destroyCharts(): void {
  for (const c of live) c.destroy()
  live.clear()
}

export const axisTitle = (text: string) => ({ display: true, text, font: { weight: 'bold' as const, size: 13 } })

/** Green KPI card: white label, amber value, optional small line under it. */
export function kpiCard(label: string, value: string, sub?: string, wide = false): HTMLElement {
  const card = document.createElement('div')
  card.className = wide ? 'kpi wide' : 'kpi'
  const add = (cls: string, text: string) => {
    const d = document.createElement('div')
    d.className = cls
    d.textContent = text
    card.append(d)
  }
  add('label', label)
  add('value', value)
  if (sub) add('sub', sub)
  return card
}

/**
 * Capsule/pill legend rendered as HTML below a chart (C: labels moved OUT of the plot so they
 * never cover the data). Each chip's color drives its border, text and dot via `currentColor`.
 */
export function chartLegend(items: { label: string; color: string }[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'chart-legend'
  for (const it of items) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.color = it.color
    const dot = document.createElement('span')
    dot.className = 'dot'
    chip.append(dot, document.createTextNode(it.label))
    wrap.append(chip)
  }
  return wrap
}

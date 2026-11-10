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

/**
 * Single source of truth for the energy display unit. The whole app shows kWh everywhere — KPI cards,
 * chart axes and tooltips, treemap, tables and the PDF — so the unit never changes between views or
 * between points on one chart (large totals just read as big kWh numbers, e.g. 450,600 kWh). This is
 * a single table so it stays consistent: to bring back automatic kWh→MWh→GWh stepping, add the rows
 * `{ at: 1e6, unit: 'GWh', div: 1e6 }` and `{ at: 1e5, unit: 'MWh', div: 1e3 }` above the kWh row.
 * Ordered high→low; first threshold met wins.
 */
const ENERGY_UNITS: { at: number; unit: string; div: number }[] = [{ at: 0, unit: 'kWh', div: 1 }]
const energyUnit = (magnitude: number): { unit: string; div: number } =>
  ENERGY_UNITS.find((u) => Math.abs(magnitude) >= u.at)!

/** Energy as a kWh figure with thousands separators: 85,792 kWh · 450,600 kWh. */
export function energy(kwh: number): string {
  const { unit, div } = energyUnit(kwh)
  return `${div === 1 ? fmt0(kwh) : fmt1(kwh / div)} ${unit}`
}

/** The display unit/divisor for a whole series, so every point scales the same way (kWh today). */
export function energyScale(maxKwh: number): { unit: string; div: number } {
  return energyUnit(maxKwh)
}

/**
 * Format a kWh value in a GIVEN scale's unit instead of re-picking one per magnitude. A line chart's
 * axis is fixed by {@link energyScale}, so its tooltips must use the same scale — otherwise, if unit
 * stepping were on, a point below the next step (e.g. 90,000 kWh under a MWh axis) would read
 * "90,000 kWh" while the axis and its neighbours read MWh. Use this for every tooltip on a scaled
 * axis; use {@link energy} only where a value stands alone (a KPI card, a treemap tile).
 */
export function energyIn(kwh: number, scale: { unit: string; div: number }): string {
  return `${scale.div === 1 ? fmt0(kwh) : fmt1(kwh / scale.div)} ${scale.unit}`
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
 * never cover the data). D4: each chip is filled solid with its series color; the label flips to
 * black or white for contrast against that fill.
 */
export function chartLegend(items: { label: string; color: string }[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'chart-legend'
  for (const it of items) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.background = it.color
    chip.style.borderColor = it.color
    chip.style.color = labelOn(it.color)
    chip.textContent = it.label
    wrap.append(chip)
  }
  return wrap
}

/** Pick a black or white label that stays readable on a solid `bg` fill (perceived-luminance test). */
function labelOn(bg: string): string {
  const h = bg.replace('#', '')
  const hex = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1a1a1a' : '#ffffff'
}

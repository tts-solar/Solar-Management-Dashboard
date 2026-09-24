import { Chart, type ChartConfiguration, type ChartType, type Plugin } from 'chart.js'

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

/**
 * Rounded "pill" labels drawn on the line itself, like the Canva slides, instead of a legend.
 * Per dataset: `pill: { at: 0..1 (position along the x-axis), dy: px offset, text?, fill?, color? }`.
 */
export interface PillSpec {
  at: number
  dy: number
  text?: string
  fill?: string
  color?: string
}
export const pillLabels: Plugin = {
  id: 'pillLabels',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart
    ctx.save()
    ctx.font = `700 12px ${Chart.defaults.font.family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    chart.data.datasets.forEach((ds, i) => {
      const spec = (ds as { pill?: PillSpec }).pill
      const meta = chart.getDatasetMeta(i)
      if (!spec || meta.hidden || !meta.data.length) return
      const pt = meta.data[Math.round((meta.data.length - 1) * spec.at)]
      const text = spec.text ?? String(ds.label ?? '')
      const w = ctx.measureText(text).width + 28
      const h = 24
      const x = Math.min(Math.max(pt.x, chartArea.left + w / 2), chartArea.right - w / 2)
      const y = Math.min(Math.max(pt.y + spec.dy, chartArea.top + h / 2), chartArea.bottom - h / 2)
      ctx.beginPath()
      ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2)
      ctx.fillStyle = spec.fill ?? String(ds.borderColor ?? C.ink)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = C.ink
      ctx.stroke()
      ctx.fillStyle = spec.color ?? '#fff'
      ctx.fillText(text, x, y)
    })
    ctx.restore()
  },
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

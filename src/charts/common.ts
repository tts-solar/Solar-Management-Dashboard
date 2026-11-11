import { Chart, type ChartConfiguration, type ChartType } from 'chart.js'
import { fmt0 } from '../format'

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

// The formatters live in src/format.ts so the data layer can use them without importing Chart.js;
// they are re-exported here so every `from '../charts/common'` import keeps working unchanged.
export { baht, energy, energyIn, energyScale, fmt0, fmt1, pct } from '../format'

/**
 * Pixel density for the charts mounted during a {@link atPixelRatio} call, in place of the screen's own.
 *
 * Chart.js draws to a canvas, and Chrome puts a canvas into a PDF as a bitmap at exactly its
 * backing-store size — while the HTML around it (titles, KPI cards, chips) stays vector, transform or
 * no transform. At the screen's ratio a Report PDF page, 1280px across 13.333in, therefore prints its
 * charts at 96–144 DPI: visibly soft next to the text beside them. 3 puts them at ~288 DPI.
 *
 * The cost is memory, and it is why this is scoped to the report instead of being switched on for the
 * live dashboard: a canvas holds ratio² times the pixels, and a report mounts every page's charts at
 * once. They are freed with the overlay.
 */
export const PRINT_PIXEL_RATIO = 3
let pixelRatio: number | undefined

/** Mount the charts that `render` creates at `ratio` device pixels per CSS pixel. */
export function atPixelRatio<T>(ratio: number, render: () => T): T {
  const previous = pixelRatio
  pixelRatio = ratio
  try {
    return render()
  } finally {
    pixelRatio = previous
  }
}

/** Create a chart in a fresh canvas inside `box`; charts are tracked so a re-render frees them. */
const live = new Set<Chart>()
export function mountChart<T extends ChartType>(box: HTMLElement, config: ChartConfiguration<T>): Chart<T> {
  const canvas = document.createElement('canvas')
  box.querySelectorAll('canvas').forEach((c) => c.remove()) // keep overlays such as .chart-note
  box.append(canvas)
  // Set on the config rather than the chart: Chart.js scales the canvas once, at construction. It then
  // keeps the value in its options, so a later resize (fitToPage settles the width over two or three
  // passes) re-scales at this density instead of falling back to the screen's. Every caller builds its
  // config as a fresh literal, so writing to it here reaches nothing else.
  // The cast is because ChartOptions is a deep-partial over a generic union, which TypeScript will not
  // let us reach into one field of; `devicePixelRatio` is a plain number on every chart type.
  if (pixelRatio !== undefined) {
    ;(config as { options?: { devicePixelRatio?: number } }).options = { ...config.options, devicePixelRatio: pixelRatio }
  }
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

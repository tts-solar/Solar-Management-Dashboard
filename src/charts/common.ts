import { Chart, type ChartConfiguration, type ChartType, type Scale, type ScriptableScaleContext } from 'chart.js'
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

/** A canvas `font` string in the dashboard's own family, for a plugin that draws its own text. */
export const canvasFont = (size: number, weight = 'normal'): string => `${weight} ${size}px ${Chart.defaults.font.family}`

/**
 * A chart's "split" lines come from the owner's settings, and before this the axis gave the reader no
 * way to tell: 80 looked like a round number the chart happened to land on. So the split gets a tick
 * of its own, drawn as a FILLED BADGE — solid block in the color of the line it belongs to, label
 * reversed out of it — while the plain ticks around it stay small and gray.
 */
const SPLIT_FONT = { weight: 'bold' as const, size: 13 }
const TICK_FONT = { weight: 'normal' as const, size: 12 }
/** Breathing room inside the badge. Kept tight horizontally: Chart.js sizes the axis margin from the
 *  TEXT, not the backdrop, so a wide pad would spill the badge past the edge of the canvas. */
const BADGE_PAD = { top: 3, bottom: 3, left: 4, right: 4 }

/** A split as an axis prints it: one decimal at most, so 80 stays "80" and 12.5 stays "12.5". */
export const splitLabel = (v: number): string => String(Math.round(v * 10) / 10)

/**
 * Axis options giving `split` a tick of its own, labelled `label` and drawn bold in `color`.
 *
 * Generated ticks near it are dropped first — a tick at 12 and a split at 12.5 would print their
 * labels on top of each other — using the axis's own step, so the gap holds however the axis scales.
 * `format` is how the REMAINING ticks are labelled, for an axis that already formats its own (`80%`).
 */
export function splitAxis(split: number, label: string, color: string, format: (v: string | number) => string = String) {
  return {
    afterBuildTicks: (axis: Scale): void => {
      if (!(split > axis.min && split < axis.max)) return // clamped onto an edge: no room for a tick
      const step = Math.abs((axis.ticks[1]?.value ?? 0) - (axis.ticks[0]?.value ?? 0)) || 1
      const ticks = axis.ticks.filter((t) => Math.abs(t.value - split) >= step * 0.6)
      ticks.push({ value: split })
      ticks.sort((a, b) => a.value - b.value)
      axis.ticks = ticks
    },
    ticks: {
      callback: (value: string | number): string => (value === split ? label : format(value)),
      // on the split: the label reversed out of a solid block; everywhere else: a plain gray number
      color: (c: ScriptableScaleContext): string => (c.tick?.value === split ? labelOn(color) : C.gray),
      font: (c: ScriptableScaleContext) => (c.tick?.value === split ? SPLIT_FONT : TICK_FONT),
      showLabelBackdrop: (c: ScriptableScaleContext): boolean => c.tick?.value === split,
      backdropColor: color,
      backdropPadding: BADGE_PAD,
    },
  }
}

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
 * A zone's `bg` as a flat color: the wash is translucent, and a chip painted with it would sit on the
 * page's own background rather than the plot's, so it is composited onto white here — exactly what
 * the eye sees inside the chart.
 */
export function zoneFill(bg: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(bg)
  if (!m) return bg
  const [r, g, b, a = 1] = m[1].split(',').map(Number)
  const over = (c: number) => Math.round(255 - a * (255 - c))
  return `#${[over(r), over(g), over(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Capsule/pill legend rendered as HTML below a chart (C: labels moved OUT of the plot so they
 * never cover the data). D4: each chip is filled with its series color; the label flips to black or
 * white for contrast against that fill. `border` outlines it in a second color, `dashed` dashes that
 * outline.
 */
export function chartLegend(items: { label: string; color: string; border?: string; dashed?: boolean }[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'chart-legend'
  for (const it of items) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.style.background = it.color
    // `border` lets a chip fill with a pale color and still read as a chip (the bubble zone key fills
    // with the zone's own wash, which on its own would be a near-white pill with no edge)
    chip.style.borderColor = it.border ?? it.color
    // a dashed outline is how a chip stands for a DASHED line in the plot (an average, not a setting)
    if (it.dashed) chip.style.borderStyle = 'dashed'
    chip.style.color = labelOn(it.color)
    chip.textContent = it.label
    wrap.append(chip)
  }
  return wrap
}

/** Pick a black or white label that stays readable on a solid `bg` fill (perceived-luminance test).
 *  Used by the legend chips and by splitAxis's badge above. */
function labelOn(bg: string): string {
  const h = bg.replace('#', '')
  const hex = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1a1a1a' : '#ffffff'
}

import type { Chart, Plugin } from 'chart.js'
import { formatYM } from '../data/metrics'
import { C, axisTitle, canvasFont, chartLegend, fmt0, mountChart, splitAxis, splitLabel, zoneFill } from './common'

/**
 * "Efficiency and Age Relationship": one bubble per plant, size = capacity, 4 zones.
 * UI: the zone NAMES are an HTML key below the chart (bubbleLegend) — they used to be pill
 * labels drawn over the plot, which covered the bubbles. The colored zones + split lines stay.
 * Each bubble carries its PLANT's name beside it (namesPlugin), placed clear of the data.
 */

export interface BubblePoint {
  id: string
  name: string
  efficiency: number // fraction
  age: number // years
  kWp: number
}

export interface BubbleOptions {
  effSplit: number // fraction — below = abnormal (settings.abnormalBelow)
  ageSplit: number // years — above = old enough to consider re-investing
  onClick(id: string): void
}

interface Zone {
  text: string
  bg: string // fill drawn behind the bubbles
  key: string // swatch color for the HTML key below the chart
  left: boolean
  top: boolean
}
const ZONES: Zone[] = [
  { text: 'Plants ที่ควร Re-invest', bg: 'rgba(242,169,59,0.16)', key: '#f2a93b', left: true, top: true },
  { text: 'Plants ที่ทำงานผิดปกติ', bg: 'rgba(192,0,0,0.13)', key: C.bad, left: true, top: false },
  { text: 'Plants ตัวอย่างน่าทำมาตรฐาน', bg: 'rgba(30,158,90,0.15)', key: C.ok, left: false, top: true },
  { text: 'Plants ทำงานปกติ', bg: 'rgba(0,0,0,0)', key: '#9aa0a6', left: false, top: false },
]

/**
 * The 4 zone names as an HTML key (chips below the chart), so nothing hides the data points.
 *
 * Each chip is painted in its zone's own wash and outlined in the stronger `key` color — reading the
 * key against the plot is then a straight color match, which solid chips in a different shade were not.
 */
export function bubbleLegend(): HTMLElement {
  const key = chartLegend(ZONES.map((z) => ({ label: z.text, color: zoneFill(z.bg), border: z.key })))
  key.classList.add('zone-key')
  return key
}

/** `effSplit` is the x split already in % — the same number the x axis labels, so line and tick agree. */
function zonesPlugin(o: BubbleOptions, effSplit: number): Plugin<'bubble'> {
  return {
    id: 'zones',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart
      const sx = Math.min(Math.max(scales.x.getPixelForValue(effSplit), a.left), a.right)
      const sy = Math.min(Math.max(scales.y.getPixelForValue(o.ageSplit), a.top), a.bottom)
      ctx.save()
      for (const z of ZONES) {
        const x0 = z.left ? a.left : sx
        const x1 = z.left ? sx : a.right
        const y0 = z.top ? a.top : sy
        const y1 = z.top ? sy : a.bottom
        ctx.fillStyle = z.bg
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      }
      // solid, not dashed: both lines here ARE settings, and the solid stroke ties them to the
      // solid badge the axis prints at each one
      ctx.strokeStyle = C.green
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx, a.top)
      ctx.lineTo(sx, a.bottom)
      ctx.moveTo(a.left, sy)
      ctx.lineTo(a.right, sy)
      ctx.stroke()
      ctx.restore()
    },
  }
}

/**
 * Each plant's NAME written beside its own bubble, so a reader can tell the circles apart without
 * hovering over them.
 *
 * C: a label still never covers data. Every bubble is an obstacle before any name is drawn, and each
 * name takes the first free slot around its own bubble — above, below, beside, cornered, then a ring
 * further out — skipping any slot a bubble or an earlier name already holds. In a cluster too tight
 * for any slot to be free, it takes the least-covered one and keeps a hairline back to its bubble.
 */
const NAME_SIZE = 12
const NAME_GAP = 5
/** px. A long name is cut with an ellipsis rather than written across its neighbours. */
const NAME_MAX = 92

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}
const hits = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
/** How many px² of `b` the boxes already placed cover — how bad a slot is when none is free. */
const cover = (b: Box, taken: Box[]): number =>
  taken.reduce((sum, t) => {
    const x = Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0)
    const y = Math.min(b.y1, t.y1) - Math.max(b.y0, t.y0)
    return sum + (x > 0 && y > 0 ? x * y : 0)
  }, 0)

/** Where a name may sit relative to its bubble, best first: over it, under it, beside it, cornered. */
const DIRS: [number, number][] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [0.8, -0.8],
  [-0.8, -0.8],
  [0.8, 0.8],
  [-0.8, 0.8],
]

/** `text` shortened until it fits `max` px, with an ellipsis standing for what was cut. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1)
  return `${cut}…`
}

function namesPlugin(points: BubblePoint[]): Plugin<'bubble'> {
  return {
    id: 'bubbleNames',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a } = chart
      const els = chart.getDatasetMeta(0).data as unknown as { x: number; y: number; options?: { radius?: number } }[]
      const radius = (i: number): number => els[i]?.options?.radius ?? 0
      ctx.save()
      ctx.font = canvasFont(NAME_SIZE, 'bold')
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      const h = NAME_SIZE + 3
      // the bubbles go in first, so a name is never written over a data point — its own or another's
      const taken: Box[] = els.map((e, i) => ({
        x0: e.x - radius(i),
        y0: e.y - radius(i),
        x1: e.x + radius(i),
        y1: e.y + radius(i),
      }))
      // biggest bubble first: it has the fewest free slots around it, so it picks before the rest
      const order = points.map((_, i) => i).sort((p, q) => radius(q) - radius(p))
      for (const i of order) {
        const e = els[i]
        if (!e) continue
        const text = ellipsize(ctx, points[i].name, NAME_MAX)
        const w = ctx.measureText(text).width + 4
        // above, below, right, left, then the four diagonals — each ring one line further out
        const slots = [0, 1, 2, 3].flatMap((step) =>
          DIRS.map(([dx, dy]) => {
            const d = NAME_GAP + radius(i) + step * h
            return { x: e.x + dx * (d + w / 2), y: e.y + dy * (d + h / 2) }
          }),
        )
        // kept inside the plot: a name beside an edge bubble slides in rather than off the canvas
        const boxes = slots.map((s) => {
          const x = Math.min(Math.max(s.x, a.left + w / 2), a.right - w / 2)
          const y = Math.min(Math.max(s.y, a.top + h / 2), a.bottom - h / 2)
          return { x, y, x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 }
        })
        // the first slot that is clear; with none clear (a tight cluster) the least-covered one, so
        // crowded names crowd as little as possible instead of all piling onto the same spot
        const spot =
          boxes.find((b) => !taken.some((t) => hits(b, t))) ??
          boxes.reduce((best, b) => (cover(b, taken) < cover(best, taken) ? b : best))
        taken.push(spot)
        // a name pushed clear of a crowd is no longer obviously its bubble's, so it keeps a hairline
        // back to it. A name sitting right against its own bubble needs none.
        const dx = spot.x - e.x
        const dy = spot.y - e.y
        const dist = Math.hypot(dx, dy)
        if (dist > radius(i) + NAME_GAP + h) {
          // walk back from the label's middle to where the line leaves its box, so the hairline
          // stops at the text rather than running under it
          const t = Math.min(w / 2 / (Math.abs(dx) || 1e-6), h / 2 / (Math.abs(dy) || 1e-6))
          ctx.strokeStyle = 'rgba(89,89,89,0.5)' // C.gray, faded: a pointer, not another line to read
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(e.x + (dx / dist) * radius(i), e.y + (dy / dist) * radius(i))
          ctx.lineTo(spot.x - dx * t, spot.y - dy * t)
          ctx.stroke()
        }
        // a white halo under the ink keeps the name readable over a zone wash or a split line
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'
        ctx.lineWidth = 3
        ctx.strokeText(text, spot.x, spot.y)
        ctx.fillStyle = C.ink
        ctx.fillText(text, spot.x, spot.y)
      }
      ctx.restore()
    },
  }
}

export function bubbleChart(box: HTMLElement, points: BubblePoint[], o: BubbleOptions): Chart<'bubble'> {
  // the axis is in %, and rounding here gives an exact value for a tick to be matched against
  const effSplit = Math.round(o.effSplit * 1000) / 10
  const effs = points.map((p) => p.efficiency * 100)
  const ages = points.map((p) => p.age)
  const xMin = Math.min(50, Math.floor((Math.min(...effs, effSplit) - 10) / 10) * 10)
  const xMax = Math.max(100, Math.ceil((Math.max(...effs, 0) + 8) / 10) * 10)
  const yMax = Math.max(20, Math.ceil(Math.max(...ages, o.ageSplit) + 3))
  const maxKwp = Math.max(...points.map((p) => p.kWp), 1)

  return mountChart(box, {
    type: 'bubble',
    data: {
      datasets: [
        {
          label: 'Plants',
          data: points.map((p) => ({ x: p.efficiency * 100, y: p.age, r: 7 + 15 * Math.sqrt(p.kWp / maxKwp) })),
          backgroundColor: 'rgba(60,60,60,0.85)',
          borderColor: '#fff',
          borderWidth: 1.5,
          hoverBackgroundColor: C.green,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 6, right: 8 } },
      scales: {
        x: {
          min: xMin,
          max: xMax,
          title: axisTitle('% Efficiency'),
          grid: { display: false },
          ...splitAxis(effSplit, `${splitLabel(effSplit)}%`, C.green),
        },
        y: {
          min: 0,
          max: yMax,
          title: axisTitle('Age of Plant (Years)'),
          grid: { display: false },
          ...splitAxis(o.ageSplit, `${splitLabel(o.ageSplit)} ปี`, C.green),
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const p = points[c.dataIndex]
              return `${p.name}: ${fmt0(p.efficiency * 100)}% · อายุ ${formatYM(p.age)} · ${fmt0(p.kWp)} kWp`
            },
          },
        },
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | undefined
        if (t) t.style.cursor = els.length ? 'pointer' : 'default'
      },
      onClick: (_e, els) => {
        if (els.length) o.onClick(points[els[0].index].id)
      },
    },
    plugins: [zonesPlugin(o, effSplit), namesPlugin(points)],
  })
}

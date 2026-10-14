import type { Chart, Plugin } from 'chart.js'
import { formatYM } from '../data/metrics'
import { C, axisTitle, fmt0, mountChart } from './common'

/** "Efficiency and Age Relationship": one bubble per plant, size = capacity, 4 labelled zones. */

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
  bg: string
  pill: string
  ink: string
  left: boolean
  top: boolean
}
const ZONES: Zone[] = [
  { text: 'Plants ที่ควร Re-invest', bg: 'rgba(242,169,59,0.16)', pill: '#f7c948', ink: C.ink, left: true, top: true },
  { text: 'Plants ที่ทำงานผิดปกติ', bg: 'rgba(192,0,0,0.13)', pill: C.bad, ink: '#fff', left: true, top: false },
  { text: 'Plants ตัวอย่างน่าทำมาตรฐาน', bg: 'rgba(30,158,90,0.15)', pill: C.ok, ink: '#fff', left: false, top: true },
  { text: 'Plants ทำงานปกติ', bg: 'rgba(0,0,0,0)', pill: '#fff', ink: C.ink, left: false, top: false },
]

function zonesPlugin(o: BubbleOptions): Plugin<'bubble'> {
  return {
    id: 'zones',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart
      const sx = Math.min(Math.max(scales.x.getPixelForValue(o.effSplit * 100), a.left), a.right)
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
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = C.gray
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(sx, a.top)
      ctx.lineTo(sx, a.bottom)
      ctx.moveTo(a.left, sy)
      ctx.lineTo(a.right, sy)
      ctx.stroke()
      ctx.restore()
    },
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart
      const sx = Math.min(Math.max(scales.x.getPixelForValue(o.effSplit * 100), a.left), a.right)
      const sy = Math.min(Math.max(scales.y.getPixelForValue(o.ageSplit), a.top), a.bottom)
      ctx.save()
      ctx.font = `700 11px ${chart.options.font?.family ?? 'sans-serif'}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const z of ZONES) {
        const x0 = z.left ? a.left : sx
        const x1 = z.left ? sx : a.right
        const w = x1 - x0
        if (w < 40) continue // zone squeezed off-screen
        const text = z.text
        const tw = Math.min(ctx.measureText(text).width + 22, w - 8)
        const h = 20
        // hug the age split line, like the slide
        const cy = z.top ? Math.max(sy - h, a.top + h / 2 + 2) : Math.min(sy + h, a.bottom - h / 2 - 2)
        const cx = x0 + w / 2
        ctx.beginPath()
        ctx.roundRect(cx - tw / 2, cy - h / 2, tw, h, h / 2)
        ctx.fillStyle = z.pill
        ctx.fill()
        ctx.strokeStyle = C.ink
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = z.ink
        ctx.fillText(text, cx, cy, tw - 10)
      }
      ctx.restore()
    },
  }
}

export function bubbleChart(box: HTMLElement, points: BubblePoint[], o: BubbleOptions): Chart<'bubble'> {
  const effs = points.map((p) => p.efficiency * 100)
  const ages = points.map((p) => p.age)
  const xMin = Math.min(50, Math.floor((Math.min(...effs, o.effSplit * 100) - 10) / 10) * 10)
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
        x: { min: xMin, max: xMax, title: axisTitle('% Efficiency'), grid: { display: false } },
        y: { min: 0, max: yMax, title: axisTitle('Age of Plant (Years)'), grid: { display: false } },
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
    plugins: [zonesPlugin(o)],
  })
}

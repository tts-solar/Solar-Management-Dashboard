import type { Chart, Plugin } from 'chart.js'
import { C, axisTitle, energy, fmt0, mountChart, pct } from './common'

/** Plant page "Efficiency vs consumption": one dot per month/day, red zone under the abnormal line. */

export interface ScatterPoint {
  key: string // 'YYYY-MM' or 'YYYY-MM-DD'
  label: string
  consumed: number // kWh
  efficiency: number // fraction
  abnormal: boolean
}

export interface ScatterOptions {
  abnormalBelow: number // fraction
  onClick?(key: string): void
}

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / (a.length || 1)

function zonePlugin(o: ScatterOptions, avgEff: number, avgUse: number): Plugin<'scatter'> {
  return {
    id: 'abnormalZone',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales } = chart
      const clampY = (v: number) => Math.min(Math.max(v, a.top), a.bottom)
      const zy = clampY(scales.y.getPixelForValue(o.abnormalBelow * 100))
      const ey = clampY(scales.y.getPixelForValue(avgEff * 100))
      const ux = Math.min(Math.max(scales.x.getPixelForValue(avgUse), a.left), a.right)
      ctx.save()
      ctx.fillStyle = 'rgba(192,0,0,0.13)'
      ctx.fillRect(a.left, zy, a.right - a.left, a.bottom - zy)
      ctx.lineWidth = 1.2
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = C.bad
      ctx.beginPath()
      ctx.moveTo(a.left, zy)
      ctx.lineTo(a.right, zy)
      ctx.stroke()
      // dashed averages, like the slide
      ctx.strokeStyle = C.gray
      ctx.beginPath()
      ctx.moveTo(a.left, ey)
      ctx.lineTo(a.right, ey)
      ctx.moveTo(ux, a.top)
      ctx.lineTo(ux, a.bottom)
      ctx.stroke()
      ctx.restore()
    },
    // C2: the abnormal-zone text label moved OUT of the plot — it is now an HTML chip below the
    // chart (see renderPlant), so nothing is drawn over the data points here.
  }
}

export function scatterChart(box: HTMLElement, points: ScatterPoint[], o: ScatterOptions): Chart<'scatter'> {
  const effs = points.map((p) => p.efficiency * 100)
  const yMax = Math.max(100, Math.ceil((Math.max(...effs, 0) + 5) / 20) * 20)
  const avgEff = mean(points.map((p) => p.efficiency))
  const avgUse = mean(points.map((p) => p.consumed))
  const color = (i: number) => (points[i]?.abnormal ? C.bad : '#4d4d4d')

  return mountChart(box, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Efficiency',
          data: points.map((p) => ({ x: p.consumed, y: p.efficiency * 100 })),
          pointRadius: points.length > 40 ? 4 : 6,
          pointHoverRadius: 8,
          pointBackgroundColor: (c) => color(c.dataIndex),
          pointBorderColor: (c) => color(c.dataIndex),
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 6, right: 8 } },
      scales: {
        x: {
          grace: '5%',
          title: axisTitle('Consume (kWh)'),
          grid: { display: false },
          ticks: { callback: (v) => fmt0(Number(v)) },
        },
        y: {
          min: 0,
          max: yMax,
          title: axisTitle('% Efficiency'),
          grid: { display: false },
          ticks: { callback: (v) => `${v}%` },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => points[items[0]?.dataIndex]?.label ?? '',
            label: (c) => {
              const p = points[c.dataIndex]
              return `Efficiency ${pct(p.efficiency, 0)} · Consume ${energy(p.consumed)}${p.abnormal ? ' (ผิดปกติ)' : ''}`
            },
          },
        },
      },
      onHover: (e, els) => {
        const t = e.native?.target as HTMLElement | undefined
        if (t && o.onClick) t.style.cursor = els.length ? 'pointer' : 'default'
      },
      onClick: (_e, els) => {
        if (els.length && o.onClick) o.onClick(points[els[0].index].key)
      },
    },
    plugins: [zonePlugin(o, avgEff, avgUse)],
  })
}

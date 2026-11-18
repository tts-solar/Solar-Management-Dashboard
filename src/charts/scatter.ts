import type { Chart, Plugin } from 'chart.js'
import { C, axisTitle, chartLegend, energy, fmt0, mountChart, pct, splitAxis, splitLabel, zoneFill } from './common'

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

/** The wash under the abnormal line, and the dot colors — one definition, used by both the plot and its key. */
const ABNORMAL_BG = 'rgba(192,0,0,0.13)'
const NORMAL_DOT = '#4d4d4d'

/**
 * The key below the chart: the two point classes, each painted in the color of the REGION it names —
 * the abnormal wash, and the plain white above the line — outlined in its dot color, so reading the
 * key against the plot is a straight color match.
 */
export function scatterLegend(abnormalText: string): HTMLElement {
  return chartLegend([
    { label: abnormalText, color: zoneFill(ABNORMAL_BG), border: C.bad },
    { label: 'ปกติ', color: '#ffffff', border: NORMAL_DOT },
  ])
}

/**
 * The dashed pair's own chip, for the heading line beside the chart title rather than the key below
 * it: it names the two lines, not a class of points, and it carries both numbers.
 *
 * Outlined dashed like the lines it names. It sits here and not on the axes because an average lands
 * wherever the data puts it, which is sometimes right on top of the setting's badge.
 */
export function scatterAverageKey(points: ScatterPoint[]): HTMLElement {
  const avg = scatterAverages(points)
  const key = chartLegend([
    {
      label: `เส้นเฉลี่ยของ Plant นี้ · ${pct(avg.efficiency, 0)} · ${energy(avg.consumed)}`,
      color: '#ffffff',
      border: C.gray,
      dashed: true,
    },
  ])
  key.classList.add('avg-key')
  return key
}

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / (a.length || 1)

/**
 * The two dashed lines: this plant's own mean efficiency and mean consumption over the points shown.
 * A straight mean per point, so each month (or day) counts once however long it is — and it moves with
 * the year/month/range filter, which is exactly what makes it worth naming in the key.
 */
export const scatterAverages = (points: ScatterPoint[]) => ({
  efficiency: mean(points.map((p) => p.efficiency)),
  consumed: mean(points.map((p) => p.consumed)),
})

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
      ctx.fillStyle = ABNORMAL_BG
      ctx.fillRect(a.left, zy, a.right - a.left, a.bottom - zy)
      // the abnormal line is a SETTING: solid, matching the badge the y axis prints at it
      ctx.lineWidth = 1.5
      ctx.strokeStyle = C.bad
      ctx.beginPath()
      ctx.moveTo(a.left, zy)
      ctx.lineTo(a.right, zy)
      ctx.stroke()
      // this plant's own averages stay dashed — measured, not chosen — and the key below the chart
      // names them with a dashed chip carrying both values
      ctx.lineWidth = 1.2
      ctx.setLineDash([5, 4])
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
  const abnormal = Math.round(o.abnormalBelow * 1000) / 10 // the axis is in %, exact so a tick can match it
  const effs = points.map((p) => p.efficiency * 100)
  const yMax = Math.max(100, Math.ceil((Math.max(...effs, 0) + 5) / 20) * 20)
  const { efficiency: avgEff, consumed: avgUse } = scatterAverages(points)
  const color = (i: number) => (points[i]?.abnormal ? C.bad : NORMAL_DOT)

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
          // the abnormal line is settings.abnormalBelow — a badge, red like the line it marks
          ...splitAxis(abnormal, `${splitLabel(abnormal)}%`, C.bad, (v) => `${v}%`),
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

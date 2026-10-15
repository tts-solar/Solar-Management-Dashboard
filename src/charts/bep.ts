import type { Chart } from 'chart.js'
import type { BepYear } from '../data/metrics'
import { C, axisTitle, baht, chartLegend, fmt0, mountChart } from './common'

/** Series shown on the BEP chart — single source for the datasets and the HTML pill legend (D3). */
const META: { label: string; color: string; pick: (y: BepYear) => number; dash: boolean }[] = [
  { label: 'เงินลงทุน', color: C.blue, pick: (y) => y.investment, dash: false },
  { label: 'Simulate', color: C.ink, pick: (y) => y.simulate, dash: false },
  { label: 'ค่าไฟที่ประหยัด', color: C.amber, pick: (y) => y.savings, dash: true },
]

/** Break-even chart: cumulative savings vs plan vs investment per year; estimated years are dashed. */
export function bepChart(box: HTMLElement, years: BepYear[]): Chart<'line'> {
  // a segment is estimated when the year it ends in has days without CSV data
  const dashed = (c: { p1DataIndex: number }) => (years[c.p1DataIndex]?.projected ? [6, 5] : undefined)
  const hollow = (i: number, color: string) => (years[i]?.projected ? '#fff' : color)
  const series = (label: string, values: number[], color: string, dash: boolean) => ({
    label,
    data: values,
    borderColor: color,
    backgroundColor: color,
    pointBackgroundColor: (c: { dataIndex: number }) => (dash ? hollow(c.dataIndex, color) : color),
    borderWidth: 3,
    pointRadius: 4,
    tension: 0,
    segment: dash ? { borderDash: dashed } : undefined,
  })

  return mountChart(box, {
    type: 'line',
    data: {
      labels: years.map((y) => String(y.year)),
      datasets: META.map((m) => series(m.label, years.map(m.pick), m.color, m.dash)),
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          title: axisTitle('Cumulative (฿)'),
          grid: { display: false },
          ticks: { callback: (v) => fmt0(Number(v)) },
        },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false }, // D3: replaced by the HTML pill legend (bepLegend)
        tooltip: {
          callbacks: {
            label: (c) => {
              const est = c.datasetIndex === 2 && years[c.dataIndex]?.projected ? ' (ประมาณการ)' : ''
              return `${c.dataset.label}: ${baht(Number(c.raw))}${est}`
            },
          },
        },
      },
    },
  })
}

/** D3: pill-shaped HTML legend for the BEP chart — one colored capsule chip per series. */
export function bepLegend(): HTMLElement {
  return chartLegend(META.map((m) => ({ label: m.label, color: m.color })))
}

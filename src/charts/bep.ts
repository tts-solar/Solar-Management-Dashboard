import type { Chart } from 'chart.js'
import type { BepYear } from '../data/metrics'
import { C, axisTitle, baht, fmt0, mountChart } from './common'

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
      datasets: [
        series('Investment', years.map((y) => y.investment), C.blue, false),
        series('Plan (Simulate)', years.map((y) => y.simulate), C.ink, false),
        series('Savings', years.map((y) => y.savings), C.amber, true),
      ],
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
        legend: { position: 'bottom', labels: { boxWidth: 14, boxHeight: 3, font: { weight: 'bold', size: 11 } } },
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

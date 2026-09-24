import type { Chart } from 'chart.js'
import { C, energy, mountChart, pct } from './common'

/** "Project Plants": tile area = production, green = normal, red = abnormal efficiency. Click drills in. */

export interface Tile {
  id: string
  name: string
  produced: number // kWh
  efficiency: number | null
  abnormal: boolean
}

export function treemapChart(box: HTMLElement, tiles: Tile[], onClick: (id: string) => void): Chart<'treemap'> {
  // the plugin needs a positive value; a plant with no production still gets a sliver
  const tree = [...tiles]
    .sort((a, b) => (b.efficiency ?? -1) - (a.efficiency ?? -1))
    .map((t) => ({ ...t, value: Math.max(t.produced, 1e-6) }))
  const tileOf = (raw: unknown): Tile | undefined => (raw as { _data?: Tile })?._data

  return mountChart(box, {
    type: 'treemap',
    data: {
      datasets: [
        {
          label: 'Plants',
          tree,
          key: 'value',
          data: [],
          spacing: 3,
          borderWidth: 0,
          backgroundColor: (ctx) => (tileOf(ctx.raw)?.abnormal ? C.bad : C.ok),
          hoverBackgroundColor: (ctx) => (tileOf(ctx.raw)?.abnormal ? '#a00000' : C.green),
          labels: {
            display: true,
            color: '#fff',
            font: [{ size: 22, weight: 'bold' }, { size: 13, weight: 'bold' }],
            overflow: 'fit',
            formatter: (ctx) => {
              const t = tileOf(ctx.raw)
              return t ? [t.name, `${pct(t.efficiency, 0)} · ${energy(t.produced)}`] : ''
            },
          },
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => tileOf(items[0]?.raw)?.name ?? '',
            label: (item) => {
              const t = tileOf(item.raw)
              return t ? `Production ${energy(t.produced)} · Efficiency ${pct(t.efficiency)}${t.abnormal ? ' (ผิดปกติ)' : ''}` : ''
            },
          },
        },
      },
      onHover: (e, els) => {
        const el = e.native?.target as HTMLElement | undefined
        if (el) el.style.cursor = els.length ? 'pointer' : 'default'
      },
      onClick: (_e, els, chart) => {
        // the controller rebuilds data from `tree`; the scriptable context carries the laid-out point
        const controller = chart.getDatasetMeta(0).controller as unknown as { getContext(i: number): { raw: unknown } }
        const raw = els.length ? controller.getContext(els[0].index).raw : undefined
        const t = tileOf(raw)
        if (t) onClick(t.id)
      },
    },
  })
}

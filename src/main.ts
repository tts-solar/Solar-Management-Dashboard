import '@fontsource/montserrat/latin-400.css'
import '@fontsource/montserrat/latin-700.css'
import '@fontsource/montserrat/latin-900-italic.css'
import './styles.css'

import { Chart, registerables } from 'chart.js'
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap'

import sampleCsv from '../data/sample-MH.csv?raw'
import { parseCsv } from './data/csv'
import { monthsOf, yearsOf } from './data/aggregate'
import { loadSettings, saveSettings, settingsFor, type SettingsMap } from './data/settings'
import type { Plant } from './data/types'
import { go, onRoute, toHash, type Route } from './app/router'
import { createShell, type Crumb } from './app/shell'
import { readEmbedded, scopedStorage, upsertPlant } from './app/store'
import { capturePristine, downloadHtml } from './app/download'
import { readPlantFiles } from './app/upload'
import { openSettings } from './app/settingsPanel'
import { MONTHS, destroyCharts } from './charts/common'
import { renderOverview as overviewView, type ViewCtx } from './views/overview'
import { renderPlant } from './views/plant'

Chart.register(...registerables, TreemapController, TreemapElement)
Chart.defaults.font.family = "'Montserrat', 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif"
Chart.defaults.color = '#111'

// a downloaded copy carries its plants + settings; read them first, then keep the page HTML pristine
const embedded = readEmbedded(document)
capturePristine(document)

// the committed CSV is synthetic; real plant files are dropped in by the user
const samplePlant = (): Plant => ({ id: 'MH', name: 'MH', daily: parseCsv(sampleCsv).daily, source: 'sample-MH.csv' })
const plants: Plant[] = embedded ? embedded.plants : [samplePlant()]
// each downloaded file saves its own edits (scoped by its download time)
const storage = scopedStorage(embedded ? `:${embedded.id}` : '')
const settings: SettingsMap = { ...embedded?.settings, ...loadSettings(storage) }
let current: Route = { view: 'overview' }

const shell = createShell(document.getElementById('app')!, {
  onFiles: (files) => void importFiles(files),
  onSettings: () => showSettings(),
  onDownload: () => {
    if (!plants.length) return shell.toast('ยังไม่มี Plant ให้บันทึก — นำเข้าไฟล์ CSV ก่อน', 'error')
    try {
      const name = downloadHtml({ v: 1, id: new Date().toISOString(), plants, settings })
      shell.toast(`ดาวน์โหลด ${name} แล้ว — เปิดไฟล์นี้ได้แม้ไม่มีอินเทอร์เน็ต`)
    } catch {
      shell.toast('สร้างไฟล์ดาวน์โหลดไม่สำเร็จ', 'error')
    }
  },
})

async function importFiles(files: File[]): Promise<void> {
  const { ok, errors } = await readPlantFiles(files)
  for (const e of errors) shell.toast(e, 'error')
  if (!ok.length) return
  for (const { plant, days, skipped } of ok) {
    const how = upsertPlant(plants, plant) === 'replaced' ? 'แทนที่' : 'เพิ่ม'
    const skip = skipped ? ` · ข้ามแถวที่อ่านไม่ได้ ${skipped} แถว` : ''
    shell.toast(`${how} Plant ${plant.id} แล้ว: ${days} วัน (${plant.daily[0].date} ถึง ${last(plant.daily)!.date})${skip}`)
  }
  const p = ok[ok.length - 1].plant
  const target: Route = ok.length === 1 ? { view: 'plant', plant: p.id, year: last(yearsOf(p.daily))! } : { view: 'overview' }
  if (toHash(target) === toHash(current)) render(current) // same URL → no hashchange, redraw by hand
  else go(target)
}

function showSettings(): void {
  if (!plants.length) return shell.toast('ยังไม่มี Plant — นำเข้าไฟล์ CSV ก่อน', 'error')
  openSettings({
    plants,
    settings,
    plantId: current.view === 'plant' ? current.plant : plants[0].id,
    displayName,
    onSave: (id, values) => {
      // keep {} (not delete) so a reset also overrides a downloaded file's embedded settings
      settings[id] = values
      const saved = saveSettings(settings, storage)
      shell.toast(saved ? 'บันทึกการตั้งค่าแล้ว' : 'ใช้ค่าใหม่แล้ว แต่เบราว์เซอร์นี้บันทึกถาวรไม่ได้')
      render(current)
    },
    onRemove: (id) => {
      const i = plants.findIndex((p) => p.id === id)
      if (i >= 0) plants.splice(i, 1)
      shell.toast(`ลบ Plant ${id} ออกแล้ว`)
      if (current.view === 'plant' && current.plant === id) go({ view: 'overview' })
      else render(current)
    },
  })
}

const last = <T>(a: T[]): T | undefined => a[a.length - 1]
const displayName = (p: Plant): string => settingsFor(settings, p.id).name ?? p.name
const viewCtx: ViewCtx = { plants, settings, displayName, open: go }
const allYears = (): string[] => [...new Set(plants.flatMap((p) => yearsOf(p.daily)))].sort()

function render(route: Route): void {
  current = route
  destroyCharts()
  if (route.view === 'overview') return renderOverview(route.year)
  const plant = plants.find((p) => p.id === route.plant)
  const years = plant ? yearsOf(plant.daily) : []
  if (!plant || !years.includes(route.year)) {
    shell.toast(plant ? `ไม่มีข้อมูลปี ${route.year} ของ ${displayName(plant)}` : `ไม่พบ Plant "${route.plant}"`, 'error')
    return go({ view: 'overview' })
  }
  const months = monthsOf(plant.daily, route.year)
  const month = route.month && months.includes(`${route.year}-${route.month}`) ? route.month : undefined
  const name = displayName(plant)
  const yearRoute: Route = { view: 'plant', plant: plant.id, year: route.year }
  const crumbs: Crumb[] = [{ label: 'Overview', route: { view: 'overview', year: route.year } }]
  crumbs.push(month ? { label: `${name} · ${route.year}`, route: yearRoute } : { label: `${name} · ${route.year}` })
  if (month) crumbs.push({ label: `${MONTHS[+month - 1]} ${route.year}` })

  shell.setHeader(month ? `Plant ${name}, ${MONTHS[+month - 1]} ${route.year}` : `Plant ${name}, Y${route.year}`, crumbs)
  shell.setPickers([
    {
      label: 'ปี',
      value: route.year,
      options: years.map((y) => ({ value: y, label: y })),
      onChange: (year) => go({ view: 'plant', plant: plant.id, year }),
    },
    {
      label: 'เดือน',
      value: month ?? '',
      options: [
        { value: '', label: 'ทั้งปี' },
        ...months.map((m) => ({ value: m.slice(5), label: MONTHS[+m.slice(5) - 1] })),
      ],
      onChange: (m) => go({ view: 'plant', plant: plant.id, year: route.year, month: m || undefined }),
    },
  ])
  setFooter(plant)
  renderPlant(shell.view, viewCtx, plant, route.year, month)
}

function renderOverview(requested?: string): void {
  const years = allYears()
  const year = requested && years.includes(requested) ? requested : years[years.length - 1]
  shell.setHeader('Overview', [{ label: 'Overview' }])
  shell.setPickers([
    {
      label: 'ปี',
      value: year ?? '',
      options: years.map((y) => ({ value: y, label: y })),
      onChange: (y) => go({ view: 'overview', year: y }),
    },
  ])
  setFooter()
  if (year) overviewView(shell.view, viewCtx, year)
  else placeholder('ยังไม่มีข้อมูล — นำเข้าไฟล์ CSV ของ Plant ได้จากปุ่มด้านบน')
}

function setFooter(plant?: Plant): void {
  const list = plant ? [plant] : plants
  const parts = list.map((p) => {
    const note = p.source.startsWith('sample') ? ' (ข้อมูลตัวอย่างสังเคราะห์)' : ''
    return `${displayName(p)}: ${p.source}${note} · ${p.daily[0]?.date ?? '-'} ถึง ${last(p.daily)?.date ?? '-'}`
  })
  shell.setFooter(parts.join('   |   '))
}

// shown when there is no data at all
function placeholder(text: string, links: Crumb[] = []): void {
  const box = document.createElement('div')
  box.className = 'empty'
  box.textContent = text
  for (const l of links) {
    const a = document.createElement('a')
    a.href = l.route ? toHash(l.route) : '#/'
    a.textContent = ` → ${l.label}`
    box.append(a)
  }
  shell.view.replaceChildren(box)
}

onRoute(render)

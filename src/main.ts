import '@fontsource/montserrat/latin-400.css'
import '@fontsource/montserrat/latin-700.css'
import '@fontsource/montserrat/latin-900-italic.css'
import './styles.css'

import { Chart, registerables } from 'chart.js'
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap'

import sampleCsv from '../data/sample-MH.csv?raw'
import { parseCsv } from './data/csv'
import { monthsOf, yearsOf } from './data/aggregate'
import { clearSettings, loadSettings, saveSettings, settingsFor, type SettingsMap } from './data/settings'
import { demoPlants, DEMO_SETTINGS } from './data/demo'
import type { Plant } from './data/types'
import { go, onRoute, toHash, type Route } from './app/router'
import { createShell, type Crumb } from './app/shell'
import { clearStored, loadPlants, readEmbedded, savePlants, scopedStorage, upsertPlant } from './app/store'
import { capturePristine, downloadHtml } from './app/download'
import { readPlantFiles } from './app/upload'
import { openSettings } from './app/settingsPanel'
import { MONTHS, destroyCharts } from './charts/common'
import { renderOverview as overviewView, type ViewCtx } from './views/overview'
import { renderPlant } from './views/plant'
import { renderWelcome } from './views/welcome'

Chart.register(...registerables, TreemapController, TreemapElement)
Chart.defaults.font.family = "'Montserrat', 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif"
Chart.defaults.color = '#111'

// a downloaded copy carries its plants + settings; read them first, then keep the page HTML pristine
const embedded = readEmbedded(document)
capturePristine(document)

// demo build = synthetic sample plants + preset settings; offline build starts empty (user imports real CSVs).
// Keep this check inline on import.meta.env.MODE: Vite turns it into a literal here, so the offline bundle
// drops the sample CSVs. A constant imported from another module is NOT folded and the samples leak in.
const IS_DEMO = import.meta.env.MODE !== 'offline'
const samplePlant = (): Plant => ({ id: 'MH', name: 'MH', daily: parseCsv(sampleCsv).daily, source: 'sample-MH.csv' })
// each file keeps its own data: a saved copy by its download time, a blank offline file by its own path
// (so two blank files in one folder never cross-see). Demo stays on the shared empty scope.
const storage = scopedStorage(embedded ? `:${embedded.id}` : IS_DEMO ? '' : `:${location.pathname}`)
// offline blank file auto-remembers imported plants in this browser — no "บันทึกไฟล์" needed
const remembered = embedded || IS_DEMO ? [] : loadPlants(storage)
const plants: Plant[] = embedded
  ? embedded.plants
  : remembered.length
    ? remembered
    : IS_DEMO
      ? [samplePlant(), ...demoPlants()]
      : []
const settings: SettingsMap = embedded
  ? { ...embedded.settings, ...loadSettings(storage) }
  : { ...(IS_DEMO ? DEMO_SETTINGS : {}), ...loadSettings(storage) }
let current: Route = { view: 'overview' }

const shell = createShell(document.getElementById('app')!, {
  // demo has no import UI (shell drops it); a no-op here also lets importFiles/readPlantFiles be tree-shaken out
  onFiles: IS_DEMO ? () => {} : (files) => void importFiles(files),
  onSettings: () => showSettings(),
  onDownload: () => {
    if (IS_DEMO) return downloadOfflineApp()
    if (!plants.length) return shell.toast('ยังไม่มี Plant ให้บันทึก — นำเข้าไฟล์ CSV ก่อน', 'error')
    try {
      const name = downloadHtml({ v: 1, id: new Date().toISOString(), plants, settings })
      shell.toast(`บันทึก ${name} แล้ว — เปิดไฟล์นี้ครั้งหน้าจะเห็นข้อมูลเดิม (ไม่ต้องใช้อินเทอร์เน็ต)`)
    } catch {
      shell.toast('สร้างไฟล์ดาวน์โหลดไม่สำเร็จ', 'error')
    }
  },
  onClear: () => {
    if (IS_DEMO || embedded) return
    if (!confirm('ล้างข้อมูลที่จำไว้ในเบราว์เซอร์นี้ทั้งหมด? (ไฟล์ที่กด "บันทึกไฟล์" ไว้แล้วจะไม่ถูกลบ)')) return
    clearStored(storage)
    clearSettings(storage)
    location.reload()
  },
})

let saveWarned = false
// auto-remember the imported plants in this browser (offline blank file only; a saved/embedded
// file reloads its baked-in data, and the demo is sample-only)
function rememberPlants(): void {
  if (IS_DEMO || embedded) return
  if (!savePlants(plants, storage) && !saveWarned) {
    saveWarned = true
    shell.toast('เบราว์เซอร์นี้จำข้อมูลอัตโนมัติไม่ได้ (พื้นที่เต็มหรือถูกปิด) — กด "บันทึกไฟล์" เพื่อเก็บข้อมูลแทน', 'error')
  }
}

/** Demo only: hand out the blank offline app (no data inside) that deploy publishes beside index.html. */
function downloadOfflineApp(): void {
  const a = document.createElement('a')
  a.href = 'solar-dashboard-offline.html'
  a.download = 'solar-dashboard-offline.html'
  a.click()
  shell.toast('กำลังดาวน์โหลดแอป Offline (ไฟล์เปล่า ไม่มีข้อมูล) — เปิดไฟล์แล้วใส่ไฟล์ข้อมูลของคุณเองบนเครื่อง')
}

async function importFiles(files: File[]): Promise<void> {
  const { ok, errors } = await readPlantFiles(files)
  for (const e of errors) shell.toast(e, 'error')
  if (!ok.length) return
  for (const { plant, days, skipped } of ok) {
    const how = upsertPlant(plants, plant) === 'replaced' ? 'แทนที่' : 'เพิ่ม'
    const skip = skipped ? ` · ข้ามแถวที่อ่านไม่ได้ ${skipped} แถว` : ''
    shell.toast(`${how} Plant ${plant.id} แล้ว: ${days} วัน (${plant.daily[0].date} ถึง ${last(plant.daily)!.date})${skip}`)
  }
  rememberPlants()
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
      rememberPlants()
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
  setFooter()
  if (!year) {
    shell.setPickers([]) // no blank year picker beside the empty state
    // IS_DEMO is a literal here, so the demo bundle drops the welcome screen entirely
    if (IS_DEMO) return placeholder('ยังไม่มีข้อมูล')
    return renderWelcome(shell.view, shell.pickFiles)
  }
  shell.setPickers([
    {
      label: 'ปี',
      value: year ?? '',
      options: years.map((y) => ({ value: y, label: y })),
      onChange: (y) => go({ view: 'overview', year: y }),
    },
  ])
  overviewView(shell.view, viewCtx, year)
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

import '@fontsource/montserrat/latin-400.css'
import '@fontsource/montserrat/latin-700.css'
import '@fontsource/montserrat/latin-900-italic.css'
import './styles.css'

import { Chart, registerables } from 'chart.js'
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap'

import { monthsOf, yearsOf } from './data/aggregate'
import { clearSettings, GLOBAL_KEY, loadSettings, missingSettings, REQUIRED_FIELD_SCOPE, saveSettings, settingsFor, type PlantSettings, type SettingsMap } from './data/settings'
import type { Plant } from './data/types'
import { go, onRoute, toHash, type Route } from './app/router'
import { createShell, type Crumb, type RangeFilter } from './app/shell'
import { installAppIcons } from './app/brand'
import { applyMerge, mergeInfo, clearStored, loadPlants, openScopedStorage, readEmbedded, savePlants, scopedStorage, storageEstimate } from './app/store'
import { capturePristine, downloadHtml, downloadBlankOffline, blankOfflineAvailable } from './app/download'
import { readPlantFiles, type Imported } from './app/upload'
import { openImportDialog } from './app/importDialog'
import { openSettings } from './app/settingsPanel'
import { openExport } from './app/exportReport'
import { openReportPdf } from './app/reportPdf'
import { confirmDialog } from './app/confirm'
import { MONTHS, destroyCharts } from './charts/common'
import { renderOverview as overviewView, type ViewCtx } from './views/overview'
import { renderPlant } from './views/plant'
import { renderWelcome } from './views/welcome'

Chart.register(...registerables, TreemapController, TreemapElement)
Chart.defaults.font.family = "'Montserrat', 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif"
Chart.defaults.color = '#111'

// brand favicon / apple-touch-icon / PWA manifest (runtime-injected; see app/brand.ts for why)
installAppIcons()

// a downloaded copy carries its plants + settings; read them first, then keep the page HTML pristine
const embedded = readEmbedded(document)
capturePristine(document)

// IS_DEMO now governs only two things: the storage SUFFIX (the online build shares one scope; a blank
// offline file is scoped per path) and the "download blank offline" handout button. BOTH builds start
// empty — the user imports real CSVs — and auto-remember them in this browser behind the CSP network-lock
// (vite.config.ts). Kept inline on import.meta.env.MODE so Vite still folds it to a literal per build.
const IS_DEMO = import.meta.env.MODE !== 'offline'
// each file keeps its own data: a saved copy by its download time, a blank offline file by its own path
// (so two blank files in one folder never cross-see). The online build shares one empty scope.
const SUFFIX = embedded ? `:${embedded.id}` : IS_DEMO ? '' : `:${location.pathname}`
// Storage is loaded asynchronously in boot() (IndexedDB is async). plants/settings stay the SAME
// arrays for the whole session — boot() fills them in place (push / assign), never reassigns — so
// viewCtx and every closure below keep their references. They start empty until boot() runs.
let storage: ReturnType<typeof scopedStorage> = null
const plants: Plant[] = []
const settings: SettingsMap = {}
let current: Route = { view: 'overview' }
// The sidebar (and its Import / Settings / Save / Export / Clear buttons) renders synchronously
// above, but storage loads asynchronously in boot(). A click in that window would run against a
// null storage — an Import wouldn't persist and a false "can't remember" toast would show. This
// flag flips true at the end of boot(); every sidebar action waits on it (H1 boot race).
let ready = false

// Block a sidebar action while boot() is still loading storage; show a gentle notice instead of
// letting the action run against the not-yet-ready state.
function notReady(): boolean {
  if (ready) return false
  shell.toast('กำลังโหลดข้อมูล… รอสักครู่', 'error')
  return true
}

const shell = createShell(document.getElementById('app')!, {
  onImport: (files) => openImport(files),
  onPlantSettings: (id, focus) => showSettings(id, focus),
  onDownload: () => saveOrDownload(),
  onExport: () => showExport(),
  onReportPdf: () => showReportPdf(),
  // No Clear Data button in a saved/embedded file — there is no remembered data to wipe there (M9).
  onClear: embedded ? undefined : () => void clearData(),
  // Demo only, and only once the blank offline build is baked in (build:offline runs before build:demo).
  onDownloadBlank: IS_DEMO && blankOfflineAvailable() ? () => handoutBlankOffline() : undefined,
  // Offline build: "Save File" renders at the sidebar bottom instead of up in the GENERAL group.
  offline: !IS_DEMO,
})

// save a portable offline copy that carries the loaded data (both builds)
function saveOrDownload(): void {
  if (notReady()) return
  if (!plants.length) return shell.toast('ยังไม่มี Plant ให้บันทึก — นำเข้าไฟล์ CSV ก่อน', 'error')
  try {
    const name = downloadHtml({ v: 1, id: new Date().toISOString(), plants, settings })
    shell.toast(`บันทึก ${name} แล้ว — เปิดไฟล์นี้ครั้งหน้าจะเห็นข้อมูลเดิม (ไม่ต้องใช้อินเทอร์เน็ต)`)
  } catch {
    shell.toast('สร้างไฟล์ดาวน์โหลดไม่สำเร็จ', 'error')
  }
}

// demo only: give the client a blank, network-locked offline copy of the app (no data, ever — not even
// anything imported in this browser; the file is the build:offline artifact baked in at build time)
function handoutBlankOffline(): void {
  try {
    const name = downloadBlankOffline()
    shell.toast(`กำลังดาวน์โหลด ${name} — ไฟล์เปล่าสำหรับใช้งานออฟไลน์ (ยังไม่มีข้อมูลใดๆ)`)
  } catch {
    shell.toast('ดาวน์โหลดไฟล์เปล่าไม่สำเร็จ', 'error')
  }
}

// wipe the data this browser auto-remembered (e.g. before handing the computer on)
async function clearData(): Promise<void> {
  if (notReady()) return
  if (embedded) return
  // Offer a backup first: clearing wipes this browser's remembered data permanently, so anything
  // imported but not yet saved to a file would be lost for good (M8).
  if (plants.length) {
    const save = await confirmDialog({
      title: 'บันทึกข้อมูลก่อนล้าง?',
      message: 'การล้างข้อมูลจะลบข้อมูลที่เบราว์เซอร์นี้จำไว้อย่างถาวร กู้คืนไม่ได้ — แนะนำให้กด "บันทึกไฟล์" เก็บไว้ก่อน เผื่ออยากเปิดดูข้อมูลเดิมภายหลัง',
      confirmText: 'บันทึกไฟล์ก่อน',
      cancelText: 'ข้าม ไปล้างเลย',
    })
    if (save) saveOrDownload()
  }
  const ok = await confirmDialog({
    title: 'ล้างข้อมูลที่จำไว้?',
    message: 'ลบข้อมูลที่เบราว์เซอร์นี้จำไว้ทั้งหมด — ไฟล์ที่เคยกด "บันทึกไฟล์" ไว้แล้วจะไม่ถูกลบ',
    confirmText: 'ล้างข้อมูล',
    danger: true,
  })
  if (!ok) return
  clearStored(storage)
  clearSettings(storage)
  // also wipe any pre-migration copy still sitting in localStorage, so "ล้างข้อมูล" truly forgets
  // everything (and the one-time migration can't resurrect it on the next open)
  const ls = scopedStorage(SUFFIX)
  clearStored(ls)
  clearSettings(ls)
  location.reload()
}

let meterWarned = false
// refresh the sidebar storage meter; warn once when the browser's quota is nearly full. The saved
// HTML file is the durable copy — browser storage is only a cache, so near-full points there.
async function refreshMeter(): Promise<void> {
  if (embedded) return
  const est = await storageEstimate()
  if (!est) return
  shell.setStorage(est.usage, est.quota)
  if (est.quota > 0 && est.usage / est.quota >= 0.8 && !meterWarned) {
    meterWarned = true
    shell.toast('พื้นที่เก็บข้อมูลใกล้เต็ม — กด "บันทึกไฟล์" เพื่อเก็บข้อมูลเป็นไฟล์ถาวร (ไฟล์ที่บันทึกไว้จะไม่หาย)', 'error')
  }
}

let saveWarned = false
// auto-remember the imported plants in this browser (offline blank file only; a saved/embedded
// file reloads its baked-in data, and the demo is sample-only)
function rememberPlants(): void {
  if (embedded) return
  if (!savePlants(plants, storage) && !saveWarned) {
    saveWarned = true
    shell.toast('เบราว์เซอร์นี้จำข้อมูลอัตโนมัติไม่ได้ (พื้นที่เต็มหรือถูกปิด) — กด "บันทึกไฟล์" เพื่อเก็บข้อมูลแทน', 'error')
  }
  void refreshMeter()
}

// open the centered preview+confirm dialog; `files` pre-fills it (drag-drop), else it opens empty.
// The dialog parses + previews the data and only calls commitImport once the user confirms.
function openImport(files?: File[]): void {
  if (notReady()) return
  openImportDialog({
    initialFiles: files,
    read: readPlantFiles,
    previewMerge: (plant) => mergeInfo(plants.find((p) => p.id === plant.id), plant),
    onConfirm: (ok) => commitImport(ok),
  })
}

// apply a confirmed import: merge each plant in, remember, and open the newly imported data
function commitImport(ok: Imported[]): void {
  for (const { plant, skipped } of ok) {
    const info = applyMerge(plants, plant)
    const skip = skipped ? ` · ข้ามแถวที่อ่านไม่ได้ ${skipped} แถว` : ''
    const how =
      info.action === 'merged'
        ? `รวมข้อมูล Plant ${plant.id}: เพิ่ม ${info.added} วันใหม่ (เดิม ${info.kept} วัน → รวม ${info.total} วัน)`
        : info.action === 'replaced'
          ? `แทนที่ Plant ${plant.id} แล้ว: ${info.total} วัน`
          : `เพิ่ม Plant ${plant.id} แล้ว: ${info.total} วัน`
    shell.toast(`${how} (${info.from} ถึง ${info.to})${skip}`)
  }
  rememberPlants()
  const p = ok[ok.length - 1].plant
  // A plant whose rows were all skipped has no years, so last(yearsOf) is undefined → a `.../undefined`
  // route that just bounces back to Overview (L1). Fall back to Overview ourselves when there is no year.
  const y = last(yearsOf(p.daily))
  const target: Route = ok.length === 1 && y ? { view: 'plant', plant: p.id, year: y } : { view: 'overview' }
  if (toHash(target) === toHash(current)) render(current) // same URL → no hashchange, redraw by hand
  else go(target)
}

function showSettings(plantId?: string, focus?: { key: keyof PlantSettings; scope: 'global' | 'plant' }): void {
  if (notReady()) return
  if (!plants.length) return shell.toast('ยังไม่มี Plant — นำเข้าไฟล์ CSV ก่อน', 'error')
  openSettings({
    plants,
    settings,
    plantId: plantId ?? (current.view === 'plant' ? current.plant : plants[0].id),
    displayName,
    focus,
    onSave: (plantValues, global) => {
      // keep {} (not delete) so a reset also overrides a downloaded file's embedded settings.
      // plantValues carries every plant edited in this session, so switching plants mid-edit no
      // longer drops the earlier plant's values.
      for (const [id, values] of Object.entries(plantValues)) settings[id] = values
      settings[GLOBAL_KEY] = global
      const saved = saveSettings(settings, storage)
      shell.toast(saved ? 'บันทึกการตั้งค่าแล้ว' : 'ใช้ค่าใหม่แล้ว แต่เบราว์เซอร์นี้บันทึกถาวรไม่ได้')
      void refreshMeter()
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

function showExport(): void {
  if (notReady()) return
  if (!plants.length) return shell.toast('ยังไม่มี Plant — นำเข้าไฟล์ CSV ก่อน', 'error')
  openExport({ plants, settings, displayName })
}

function showReportPdf(): void {
  if (notReady()) return
  if (!plants.length) return shell.toast('ยังไม่มี Plant — นำเข้าไฟล์ CSV ก่อน', 'error')
  openReportPdf({
    plants,
    displayName,
    renderOverview: (el, year) => overviewView(el, viewCtx, year),
    renderPlant: (el, plant, year, month) => renderPlant(el, viewCtx, plant, year, month),
    // the print pages mount their own charts into the shared registry; tear them all down and rebuild
    // the live view so the dashboard behind the overlay is clean again (destroyCharts runs inside render).
    onDone: () => render(current),
  })
}

const last = <T>(a: T[]): T | undefined => a[a.length - 1]
const displayName = (p: Plant): string => settingsFor(settings, p.id).name ?? p.name
const viewCtx: ViewCtx = { plants, settings, displayName, open: go }
const allYears = (): string[] => [...new Set(plants.flatMap((p) => yearsOf(p.daily)))].sort()
// earliest/latest data date (across all plants, or one plant) — bounds the date-range pickers and is
// the default "full range". Empty when there is no data yet.
const dataRange = (list: Plant[] = plants): { min?: string; max?: string } => {
  const dates = [...new Set(list.flatMap((p) => p.daily.map((d) => d.date)))].sort()
  return { min: dates[0], max: dates[dates.length - 1] }
}

// Build the toggle + date-range control for the filter bar. `toRoute` turns a range patch into a full
// route: `{}` (period mode, drops start/end) or `{ start, end }` (range mode). Switching INTO range
// mode defaults to the full data span [min, max]; switching out returns to the year/month view.
function rangeFilter(
  range: { start: string; end: string } | undefined,
  min: string,
  max: string,
  toRoute: (patch: { start?: string; end?: string }) => Route,
): RangeFilter {
  return {
    mode: range ? 'range' : 'period',
    start: range?.start ?? min,
    end: range?.end ?? max,
    min,
    max,
    onModeChange: (m) => go(m === 'range' ? toRoute({ start: min, end: max }) : toRoute({})),
    onRangeChange: (start, end) => go(toRoute({ start, end })),
  }
}

// Thai labels for the important fields the bell reports as missing (the data requested from the Owner)
const MISSING_LABELS: Partial<Record<keyof PlantSettings, string>> = {
  kWp: 'ขนาดติดตั้ง',
  performanceRatio: 'Performance Ratio',
  sunHours: 'ชั่วโมงแดดต่อวัน',
  tariff: 'ค่าไฟ',
  abnormalBelow: 'เกณฑ์ Efficiency ผิดปกติ',
  paybackPlanYears: 'แผนคืนทุน',
  reinvestAge: 'อายุ Re-invest',
}

// refresh the header bell from the current plants/settings (plants missing an important value)
function refreshBell(): void {
  const items = plants
    .map((p) => ({
      id: p.id,
      name: displayName(p),
      missing: missingSettings(settings, p.id).map((k) => ({ key: k, label: MISSING_LABELS[k] ?? k, scope: REQUIRED_FIELD_SCOPE[k] })),
    }))
    .filter((x) => x.missing.length > 0)
  shell.setIncomplete(items)
}

function render(route: Route): void {
  current = route
  destroyCharts()
  shell.setActive('dashboard')
  refreshBell()
  if (route.view === 'overview') return renderOverview(route)
  const plant = plants.find((p) => p.id === route.plant)
  const years = plant ? yearsOf(plant.daily) : []
  if (!plant || !years.includes(route.year)) {
    shell.toast(plant ? `ไม่มีข้อมูลปี ${route.year} ของ ${displayName(plant)}` : `ไม่พบ Plant "${route.plant}"`, 'error')
    return go({ view: 'overview' })
  }
  const range = route.start && route.end ? { start: route.start, end: route.end } : undefined
  const months = monthsOf(plant.daily, route.year)
  // a month only applies in the year/month filter; a custom range ignores it
  const month = !range && route.month && months.includes(`${route.year}-${route.month}`) ? route.month : undefined
  const name = displayName(plant)
  const yearRoute: Route = { view: 'plant', plant: plant.id, year: route.year }
  const crumbs: Crumb[] = [{ label: 'Overview', route: { view: 'overview', year: route.year } }]
  crumbs.push(month ? { label: `${name} · ${route.year}`, route: yearRoute } : { label: `${name} · ${route.year}` })
  if (month) crumbs.push({ label: `${MONTHS[+month - 1]} ${route.year}` })

  const titleName = /^plant\b/i.test(name) ? name : `Plant ${name}`
  const header = range
    ? `${titleName}, ${range.start} ถึง ${range.end}`
    : month
      ? `${titleName}, ${MONTHS[+month - 1]} ${route.year}`
      : `${titleName}, Y${route.year}`
  shell.setHeader(header, crumbs)
  const dr = dataRange([plant])
  shell.setPickers(
    [
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
    ],
    dr.min && dr.max ? rangeFilter(range, dr.min, dr.max, (r) => ({ view: 'plant', plant: plant.id, year: route.year, ...r })) : undefined,
  )
  setFooter(plant)
  renderPlant(shell.view, viewCtx, plant, route.year, month, range)
}

function renderOverview(route: Extract<Route, { view: 'overview' }>): void {
  const years = allYears()
  const range = route.start && route.end ? { start: route.start, end: route.end } : undefined
  const year = range ? undefined : route.year && years.includes(route.year) ? route.year : years[years.length - 1]
  const header = range ? `Overview · ${range.start} ถึง ${range.end}` : year ? `Overview · ปี ${year}` : 'Overview'
  shell.setHeader(header, [{ label: 'Overview' }])
  setFooter()
  if (!year && !range) {
    shell.setPickers([]) // no data yet → no filter beside the welcome screen
    return renderWelcome(shell.view, shell.openImport)
  }
  const dr = dataRange()
  shell.setPickers(
    range
      ? []
      : [
          {
            label: 'ปี',
            value: year ?? '',
            options: years.map((y) => ({ value: y, label: y })),
            onChange: (y) => go({ view: 'overview', year: y }),
          },
        ],
    dr.min && dr.max ? rangeFilter(range, dr.min, dr.max, (r) => ({ view: 'overview', ...r })) : undefined,
  )
  overviewView(shell.view, viewCtx, year ?? '', range)
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

// Storage (IndexedDB) loads asynchronously, then we fill the shared plants/settings arrays in
// place and do the first render. The sidebar buttons render synchronously before this resolves,
// so each sidebar action guards on `ready` (set true at the end here) to avoid running against a
// null storage — the UI view itself only appears once boot() has loaded the data.
async function boot(): Promise<void> {
  storage = await openScopedStorage(SUFFIX)
  const remembered = embedded ? [] : loadPlants(storage)
  const initial: Plant[] = embedded ? embedded.plants : remembered
  plants.push(...initial)
  Object.assign(
    settings,
    embedded ? { ...embedded.settings, ...loadSettings(storage) } : loadSettings(storage),
  )
  void refreshMeter()
  onRoute(render)
  ready = true // storage loaded + arrays filled + routing wired — sidebar actions may run now
}

void boot()

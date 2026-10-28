import { toHash, type Route } from './router'
import type { PlantSettings } from '../data/settings'
import { LOGO_DARK } from './brand'

/** App frame: left sidebar (brand + nav) beside a main column of header / view / footer. */

export interface ShellHandlers {
  /** Open the centered import dialog; `files` pre-fills it (e.g. a drag-drop), else it opens empty. */
  onImport(files?: File[]): void
  /** Open the per-plant settings dialog; `plantId` preselects that plant and `focus` opens straight to one field (from the bell). */
  onPlantSettings(plantId?: string, focus?: MissingField): void
  /** Save a portable copy of the loaded data (both builds). */
  onDownload(): void
  /** Open the export-report dialog (pick plants + granularity → printable PDF). */
  onExport(): void
  /** Open the Report PDF dialog (snapshot the real dashboard charts → printable PDF). */
  onReportPdf(): void
  /** Demo only: hand the client a blank copy of the offline app (absent in the offline build itself). */
  onDownloadBlank?(): void
  /** Offline: wipe the data this browser auto-remembered. Absent in a saved/embedded file (nothing to clear). */
  onClear?(): void
  /** Offline build: render "Save File" at the sidebar bottom instead of in the GENERAL group. */
  offline?: boolean
}

export interface Crumb {
  label: string
  route?: Route // omitted → current page, not a link
}

export interface PickerOption {
  value: string
  label: string
}

export interface Picker {
  label: string
  options: PickerOption[]
  value: string
  onChange(value: string): void
}

/**
 * The date-range side of the filter: a two-button mode toggle (year/month ↔ custom range) plus, in
 * range mode, two date inputs. `start`/`end` are the current range; `min`/`max` bound the pickers to
 * the loaded data. The shell only renders the range inputs when `mode === 'range'`.
 */
export interface RangeFilter {
  mode: 'period' | 'range'
  start: string
  end: string
  min: string
  max: string
  onModeChange(mode: 'period' | 'range'): void
  onRangeChange(start: string, end: string): void
}

/** One unfilled important field: its key (to open the right input), a Thai label, and which tab it lives in. */
export interface MissingField {
  key: keyof PlantSettings
  label: string
  scope: 'global' | 'plant'
}

/** A plant whose important fields are still unfilled, listed under the header bell. */
export interface IncompletePlant {
  id: string
  name: string
  missing: MissingField[]
}

/** Which sidebar item is highlighted. Dashboard is the only page; the rest run actions on click. */
export type NavKey = 'dashboard'

export interface Shell {
  view: HTMLElement
  setHeader(context: string, crumbs: Crumb[]): void
  /** Fill the top-right filter: the year/month dropdowns, plus an optional date-range toggle + inputs. */
  setPickers(pickers: Picker[], filter?: RangeFilter): void
  setFooter(text: string): void
  setActive(nav: NavKey): void
  toast(message: string, kind?: 'info' | 'error'): void
  /** Update the sidebar storage meter (offline build only; no-op in the demo). */
  setStorage(used: number, quota: number): void
  /** Open the centered import dialog (e.g. from the welcome screen's button). */
  openImport(): void
  /** Refresh the header bell: badge count + the dropdown list of plants with missing data. */
  setIncomplete(items: IncompletePlant[]): void
}

/** Human-readable byte size for the storage meter (GB / MB / KB). */
function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${Math.max(0, Math.round(b / 1e3))} KB`
}

const ICONS = {
  // sidebar nav glyphs (filled — .nav-item svg uses fill:currentColor)
  dashboard: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  settings:
    'M19.4 13a7.5 7.5 0 000-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 00-1.7-1L15 3.5h-4l-.3 2.5a7.4 7.4 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.5h4l.3-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
  save: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  download: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  bell: 'M12 2a6 6 0 00-6 6v3.6l-1.7 3.4A1 1 0 005.2 17h13.6a1 1 0 00.9-1.4L18 11.6V8a6 6 0 00-6-6zm0 20a3 3 0 002.8-2H9.2A3 3 0 0012 22z',
  report: 'M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5zM8 13h2v4H8v-4zm3-2h2v6h-2v-6zm3 3h2v3h-2v-3z',
  // printer — the Report PDF action (snapshot the dashboard to print)
  print: 'M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8v5zm3-8a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM18 3H6v4h12V3z',
  // funnel — labels the year/month pickers as a time filter so users notice they can change the range
  filter: 'M3 4h18v2.6l-6.8 7.1V20l-4.4 2.2v-7.5L3 6.6V4z',
}

// toast glyphs — stroke icons (the <svg> sets fill:none, stroke:currentColor)
const TOAST_OK = '<path d="M20 6 9 17l-5-5"/>'
const TOAST_ALERT =
  '<path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** A sidebar link: icon + label, highlighted when its route is active. */
function navItem(icon: keyof typeof ICONS, label: string, route: Route): HTMLAnchorElement {
  const a = el('a', 'nav-item')
  a.href = toHash(route)
  a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`
  a.append(el('span', '', label))
  return a
}

/** A sidebar command button: icon + label, runs onClick on press (no route). Styled as .nav-item. */
function actionItem(icon: keyof typeof ICONS, label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const b = el('button', danger ? 'nav-item danger' : 'nav-item')
  b.type = 'button'
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`
  b.append(el('span', '', label))
  b.addEventListener('click', onClick)
  return b
}

const csvOnly = (list: FileList | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')

export function createShell(root: HTMLElement, h: ShellHandlers): Shell {
  root.replaceChildren()

  // ── left sidebar: brand + nav (built once, permanent on every view) ──
  const sidebar = el('aside', 'sidebar')
  const brand = el('h1', 'brand')
  const brandLogo = el('img', 'brand-logo')
  brandLogo.src = LOGO_DARK
  brandLogo.alt = 'Solar Management Dashboard'
  brand.append(brandLogo)
  const nav = el('nav', 'side-nav')
  nav.setAttribute('aria-label', 'หลัก')

  const dashLink = navItem('dashboard', 'Dashboard', { view: 'overview' })
  const navLinks: Record<NavKey, HTMLAnchorElement> = { dashboard: dashLink }

  const menuGroup = el('div', 'nav-group')
  menuGroup.append(el('span', 'nav-label', 'MENU'), dashLink)

  // GENERAL group: direct-action items (run on click), not routes. Same in both builds now — the CSP
  // network-lock (vite.config.ts) keeps imported data from ever leaving the page, online included.
  const generalGroup = el('div', 'nav-group')
  generalGroup.append(el('span', 'nav-label', 'GENERAL'))
  generalGroup.append(actionItem('upload', 'Import Data', () => h.onImport()))
  generalGroup.append(actionItem('settings', 'Plant Settings', h.onPlantSettings))
  // Offline: "Save File" sits at the sidebar bottom instead (see the bottom group below); demo keeps it here.
  if (!h.offline) generalGroup.append(actionItem('save', 'Save File', h.onDownload))
  generalGroup.append(actionItem('report', 'Export Report', h.onExport))
  generalGroup.append(actionItem('print', 'Report PDF', h.onReportPdf))
  // A saved/embedded file has no browser-remembered data to wipe, so Clear Data is omitted there — it
  // used to render as a dead button that clearData() ignored (M9). Only wire it when a handler exists.
  if (h.onClear) generalGroup.append(actionItem('trash', 'Clear Data', h.onClear, true))

  nav.append(menuGroup, generalGroup)
  sidebar.append(brand, nav)

  // Bottom group, on its own just above the storage meter — a different kind of action from the day-to-day
  // data tools above. Demo: the "Blank Offline Copy" handout. Offline: "Save File" (relocated here).
  const bottomActions: HTMLButtonElement[] = []
  if (h.onDownloadBlank) bottomActions.push(actionItem('download', 'Blank Offline Copy', h.onDownloadBlank))
  if (h.offline) bottomActions.push(actionItem('save', 'Save File', h.onDownload))
  if (bottomActions.length) {
    const bottomGroup = el('div', 'nav-group nav-group-bottom')
    bottomGroup.append(...bottomActions)
    sidebar.append(bottomGroup)
  }

  // storage meter at the sidebar bottom (both builds — imported/remembered data can fill up either).
  let meterFill: HTMLElement | null = null
  let meterText: HTMLElement | null = null
  {
    const meter = el('div', 'nav-meter')
    const bar = el('div', 'nav-meter-bar')
    meterFill = el('i')
    bar.append(meterFill)
    meterText = el('span', 'nav-meter-text', 'พื้นที่เก็บข้อมูล')
    meter.append(bar, meterText)
    sidebar.append(meter)
  }

  // ── main column: header / view / footer ──
  const main = el('div', 'main-wrap')
  const header = el('header', 'top')
  const pageTitle = el('h2', 'page-title')
  const crumbs = el('nav', 'crumbs')
  crumbs.setAttribute('aria-label', 'breadcrumb')
  const pickers = el('div', 'pickers')
  const headRow = el('div', 'head-row')
  headRow.append(crumbs, pickers)
  header.append(pageTitle, headRow)

  // ── bell: "ข้อมูลไม่ครบ" notifier, top-right of the header ──
  const bellWrap = el('div', 'bell-wrap')
  const bell = el('button', 'bell')
  bell.type = 'button'
  bell.setAttribute('aria-label', 'การแจ้งเตือนข้อมูลไม่ครบ')
  bell.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.bell}"/></svg>`
  const bellBadge = el('span', 'bell-badge')
  bellBadge.hidden = true
  bell.append(bellBadge)
  const bellMenu = el('div', 'bell-menu')
  bellMenu.hidden = true
  bellMenu.addEventListener('click', (e) => e.stopPropagation())
  bellWrap.append(bell, bellMenu)
  header.append(bellWrap)
  bell.addEventListener('click', (e) => {
    e.stopPropagation()
    bellMenu.hidden = !bellMenu.hidden
  })
  root.addEventListener('click', () => (bellMenu.hidden = true)) // click elsewhere closes the menu

  const view = el('main', 'view')
  const footer = el('footer', 'bar')
  main.append(header, view, footer)

  const toastBox = el('div', 'toasts')
  toastBox.setAttribute('role', 'status')
  root.append(sidebar, main, toastBox)

  // drag a CSV anywhere on the page → open the import dialog pre-filled with the dropped files
  {
    const drop = el('div', 'drop-overlay', 'วางไฟล์ CSV ที่นี่')
    root.append(drop)
    let depth = 0
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return
      depth++
      drop.classList.add('on')
    })
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) drop.classList.remove('on')
    })
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault()
    })
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      drop.classList.remove('on')
      const files = csvOnly(e.dataTransfer?.files)
      if (files.length) h.onImport(files)
      else toast('รองรับเฉพาะไฟล์ .csv', 'error')
    })
  }

  function toast(message: string, kind: 'info' | 'error' = 'info'): void {
    const t = el('div', `toast ${kind}`)
    t.innerHTML = `<svg class="toast-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kind === 'error' ? TOAST_ALERT : TOAST_OK}</svg>`
    t.append(el('span', 'toast-msg', message))
    t.addEventListener('click', () => t.remove()) // tap to dismiss early
    toastBox.append(t)
    setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4000)
  }

  return {
    view,
    setHeader(ctx, list) {
      pageTitle.textContent = ctx
      document.title = ctx ? `Solar Management Dashboard · ${ctx}` : 'Solar Management Dashboard'
      crumbs.replaceChildren()
      list.forEach((c, i) => {
        if (i) crumbs.append(el('span', 'sep', '›'))
        if (c.route) {
          const a = el('a', '', c.label)
          a.href = toHash(c.route)
          crumbs.append(a)
        } else crumbs.append(el('span', 'here', c.label))
      })
    },
    setPickers(list, filter) {
      pickers.replaceChildren()
      // a "ช่วงเวลา" cue + funnel icon marks the group as a filter — otherwise the bare ปี/เดือน
      // dropdowns sit alone top-right and users miss that they change the whole view's time range
      if (list.length || filter) {
        const cue = el('span', 'pickers-cue')
        cue.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.filter}"/></svg>`
        cue.append(el('span', '', 'ช่วงเวลา'))
        pickers.append(cue)
      }

      // mode toggle: switch between the year/month dropdowns and a custom date range
      if (filter) {
        const toggle = el('div', 'mode-toggle')
        toggle.setAttribute('role', 'tablist')
        toggle.setAttribute('aria-label', 'เลือกรูปแบบช่วงเวลา')
        const modeBtn = (mode: 'period' | 'range', text: string): HTMLButtonElement => {
          const b = el('button', 'mode-btn', text)
          b.type = 'button'
          b.setAttribute('role', 'tab')
          const on = filter.mode === mode
          b.classList.toggle('on', on)
          b.setAttribute('aria-selected', String(on))
          if (!on) b.addEventListener('click', () => filter.onModeChange(mode))
          return b
        }
        toggle.append(modeBtn('period', 'ปี/เดือน'), modeBtn('range', 'ช่วงวัน'))
        pickers.append(toggle)
      }

      if (!filter || filter.mode === 'period') {
        for (const p of list) {
          const label = el('label', 'picker')
          const select = el('select')
          for (const o of p.options) {
            const opt = el('option', '', o.label)
            opt.value = o.value
            select.append(opt)
          }
          select.value = p.value
          select.addEventListener('change', () => p.onChange(select.value))
          label.append(el('span', '', p.label), select)
          pickers.append(label)
        }
      } else {
        // range mode: two date inputs bounded to the loaded data; commit on either change (swap if reversed)
        let curStart = filter.start
        let curEnd = filter.end
        const commit = (): void => {
          if (!curStart || !curEnd) return
          const [s, e] = curStart <= curEnd ? [curStart, curEnd] : [curEnd, curStart]
          filter.onRangeChange(s, e)
        }
        const dateInput = (labelTxt: string, value: string, set: (v: string) => void): HTMLLabelElement => {
          const label = el('label', 'picker picker-date')
          const input = el('input')
          input.type = 'date'
          input.value = value
          input.min = filter.min
          input.max = filter.max
          input.addEventListener('change', () => {
            set(input.value)
            commit()
          })
          label.append(el('span', '', labelTxt), input)
          return label
        }
        pickers.append(
          dateInput('จาก', filter.start, (v) => (curStart = v)),
          dateInput('ถึง', filter.end, (v) => (curEnd = v)),
        )
      }
    },
    setFooter(text) {
      footer.textContent = text
    },
    setActive(nav) {
      for (const key of Object.keys(navLinks) as NavKey[]) navLinks[key].classList.toggle('on', key === nav)
    },
    toast,
    setStorage(used, quota) {
      if (!meterFill || !meterText) return // demo build has no meter
      const pct = quota > 0 ? (used / quota) * 100 : 0
      meterFill.style.width = `${Math.min(100, pct)}%`
      meterText.textContent = `ใช้พื้นที่ ${fmtBytes(used)} / ${fmtBytes(quota)}`
      meterText.parentElement?.classList.toggle('warn', pct >= 80)
    },
    openImport: () => h.onImport(),
    setIncomplete(items) {
      bellBadge.textContent = String(items.length)
      bellBadge.hidden = items.length === 0
      bell.classList.toggle('has', items.length > 0)
      bellMenu.replaceChildren()
      bellMenu.append(
        el('div', 'bell-head', items.length ? `ข้อมูลไม่ครบ · ${items.length} Plant` : 'ข้อมูลครบทุก Plant ✓'),
      )
      for (const it of items) {
        const block = el('div', 'bell-item')
        block.append(el('span', 'bell-item-name', it.name))
        // one chip per missing field — clicking it opens the settings dialog straight to that field
        const chips = el('div', 'bell-chips')
        for (const m of it.missing) {
          const chip = el('button', 'bell-chip')
          chip.type = 'button'
          chip.textContent = m.label
          chip.setAttribute('aria-label', `กรอก ${m.label} ของ ${it.name}`)
          chip.addEventListener('click', () => {
            bellMenu.hidden = true
            h.onPlantSettings(it.id, m)
          })
          chips.append(chip)
        }
        block.append(chips)
        bellMenu.append(block)
      }
    },
  }
}

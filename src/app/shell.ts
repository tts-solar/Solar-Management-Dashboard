import { toHash, type Route } from './router'

/** App frame: left sidebar (brand + nav) beside a main column of header / view / footer. */

export interface ShellHandlers {
  /** Open the centered import dialog; `files` pre-fills it (e.g. a drag-drop), else it opens empty. */
  onImport(files?: File[]): void
  /** Open the per-plant settings dialog; `plantId` preselects that plant (e.g. from the bell menu). */
  onPlantSettings(plantId?: string): void
  /** Save a portable copy of the loaded data (both builds). */
  onDownload(): void
  /** Demo only: hand the client a blank copy of the offline app (absent in the offline build itself). */
  onDownloadBlank?(): void
  /** Offline: wipe the data this browser auto-remembered. */
  onClear(): void
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

/** A plant whose important fields are still unfilled, listed under the header bell. */
export interface IncompletePlant {
  id: string
  name: string
  missing: string[] // Thai labels of the missing fields (e.g. "ขนาดติดตั้ง", "ค่าไฟ")
}

/** Which sidebar item is highlighted. Dashboard is the only page; the rest run actions on click. */
export type NavKey = 'dashboard'

export interface Shell {
  view: HTMLElement
  setHeader(context: string, crumbs: Crumb[]): void
  setPickers(pickers: Picker[]): void
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
  brand.append(el('span', 'b-solar', 'Solar'), ' ', el('span', 'b-main', 'Management Dashboard'))
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
  generalGroup.append(actionItem('save', 'Save File', h.onDownload))
  generalGroup.append(actionItem('trash', 'Clear Data', h.onClear, true))

  nav.append(menuGroup, generalGroup)
  sidebar.append(brand, nav)

  // Demo only: handing the client a blank offline copy is a different kind of action from the data tools
  // above, so it sits on its own, pushed to the sidebar bottom (just above the storage meter).
  if (h.onDownloadBlank) {
    const bottomGroup = el('div', 'nav-group nav-group-bottom')
    bottomGroup.append(actionItem('download', 'Blank Offline Copy', h.onDownloadBlank))
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
    setPickers(list) {
      pickers.replaceChildren()
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
        const b = el('button', 'bell-item')
        b.type = 'button'
        b.append(el('span', 'bell-item-name', it.name), el('small', 'bell-item-miss', `ขาด: ${it.missing.join(', ')}`))
        b.addEventListener('click', () => {
          bellMenu.hidden = true
          h.onPlantSettings(it.id)
        })
        bellMenu.append(b)
      }
    },
  }
}

import { toHash, type Route } from './router'

/** App frame: left sidebar (brand + nav) beside a main column of header / view / footer. */

export interface ShellHandlers {
  /** A CSV drop/pick happened (offline build only; the demo passes a no-op). */
  onFiles(files: File[]): void
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

/** Which sidebar item is highlighted. Settings is its own page; every data view is "dashboard". */
export type NavKey = 'dashboard' | 'settings'

export interface Shell {
  view: HTMLElement
  setHeader(context: string, crumbs: Crumb[]): void
  setPickers(pickers: Picker[]): void
  setFooter(text: string): void
  setActive(nav: NavKey): void
  toast(message: string, kind?: 'info' | 'error'): void
  /** Open the CSV file picker (offline build only; no-op in the demo). */
  pickFiles(): void
}

const ICONS = {
  // sidebar nav glyphs
  dashboard: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  settings:
    'M19.4 13a7.5 7.5 0 000-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 00-1.7-1L15 3.5h-4l-.3 2.5a7.4 7.4 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.5h4l.3-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
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

const csvOnly = (list: FileList | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')

export function createShell(root: HTMLElement, h: ShellHandlers): Shell {
  root.replaceChildren()

  // demo build = sample-only showcase: no import UI (file input, drag-drop) at all.
  // Keep this check inline on import.meta.env.MODE so the import branch is tree-shaken out of the demo
  // bundle — a constant imported from another module is NOT folded (see IS_DEMO in main.ts).
  const IS_DEMO = import.meta.env.MODE !== 'offline'

  // ── left sidebar: brand + nav (built once, permanent on every view) ──
  const sidebar = el('aside', 'sidebar')
  const brand = el('h1', 'brand')
  brand.append(el('span', 'b-solar', 'Solar'), ' ', el('span', 'b-main', 'Management Dashboard'))
  const nav = el('nav', 'side-nav')
  nav.setAttribute('aria-label', 'หลัก')

  const dashLink = navItem('dashboard', 'Dashboard', { view: 'overview' })
  const setLink = navItem('settings', 'Settings', { view: 'settings' })
  const navLinks: Record<NavKey, HTMLAnchorElement> = { dashboard: dashLink, settings: setLink }

  const menuGroup = el('div', 'nav-group')
  menuGroup.append(el('span', 'nav-label', 'MENU'), dashLink)
  const generalGroup = el('div', 'nav-group')
  generalGroup.append(el('span', 'nav-label', 'GENERAL'), setLink)
  nav.append(menuGroup, generalGroup)
  sidebar.append(brand, nav)

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

  const view = el('main', 'view')
  const footer = el('footer', 'bar')
  main.append(header, view, footer)

  const toastBox = el('div', 'toasts')
  toastBox.setAttribute('role', 'status')
  root.append(sidebar, main, toastBox)

  // hidden file input powers both the Settings-page "นำเข้า CSV" button and drag-drop (offline only)
  let pickFiles = (): void => {}
  if (!IS_DEMO) {
    const input = el('input')
    input.type = 'file'
    input.accept = '.csv,text/csv'
    input.multiple = true
    input.hidden = true
    input.addEventListener('change', () => {
      const files = csvOnly(input.files)
      input.value = '' // same file can be picked again
      if (files.length) h.onFiles(files)
    })
    pickFiles = () => input.click()
    root.append(input)

    // drag a CSV anywhere on the page
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
      if (files.length) h.onFiles(files)
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
    pickFiles: () => pickFiles(),
  }
}

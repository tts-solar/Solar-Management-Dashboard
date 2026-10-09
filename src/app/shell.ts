import { toHash, type Route } from './router'

/** App frame from the Canva design: tricolor title, toolbar, view area, sage footer bar. */

export interface ShellHandlers {
  onFiles(files: File[]): void
  onSettings(): void
  onDownload(): void
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

export interface Shell {
  view: HTMLElement
  setHeader(context: string, crumbs: Crumb[]): void
  setPickers(pickers: Picker[]): void
  setFooter(text: string): void
  toast(message: string, kind?: 'info' | 'error'): void
  /** Open the CSV file picker (offline build only; no-op in the demo). */
  pickFiles(): void
}

const ICONS = {
  upload: 'M12 3l5 5h-3v6h-4V8H7l5-5zM5 17h14v3H5z',
  settings:
    'M19.4 13a7.5 7.5 0 000-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 00-1.7-1L15 3.5h-4l-.3 2.5a7.4 7.4 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 2.5h4l.3-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
  download: 'M10 3h4v7h3l-5 5-5-5h3V3zM5 17h14v3H5z',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function button(icon: keyof typeof ICONS, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'tool')
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

  const header = el('header', 'top')
  const title = el('h1', 'title')
  const context = el('span', 't-ctx')
  title.append(el('span', 't-solar', 'Solar'), ' ', el('span', 't-main', 'Management Dashboard'), ' ', context)

  const crumbs = el('nav', 'crumbs')
  crumbs.setAttribute('aria-label', 'breadcrumb')

  // demo build = sample-only showcase: no import UI (file input, upload button, drag-drop) at all.
  // Keep this check inline on import.meta.env.MODE so the import branch is tree-shaken out of the demo
  // bundle — a constant imported from another module is NOT folded (see IS_DEMO in main.ts).
  const IS_DEMO = import.meta.env.MODE !== 'offline'

  const tools = el('div', 'tools')
  const pickers = el('div', 'pickers')
  tools.append(pickers)
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
    tools.append(button('upload', 'นำเข้า CSV', pickFiles), input)
  }
  tools.append(
    button('settings', 'ตั้งค่า', h.onSettings),
    // demo: fetches the blank offline app (no data) · offline: saves a snapshot with the loaded data
    button('download', IS_DEMO ? 'ดาวน์โหลดแอป Offline' : 'บันทึกไฟล์', h.onDownload),
  )

  // title gets the full width like the slides; breadcrumb + toolbar share the row below it
  const subRow = el('div', 'head-row')
  subRow.append(crumbs, tools)
  header.append(title, subRow)
  // permanent on every view: the header is built once and never replaced by routing
  if (IS_DEMO) header.prepend(el('div', 'demo-banner', 'ข้อมูลตัวอย่าง (สังเคราะห์) — ไม่ใช่ข้อมูลจริง'))

  const view = el('main', 'view')
  const footer = el('footer', 'bar')
  const toastBox = el('div', 'toasts')
  toastBox.setAttribute('role', 'status')
  root.append(header, view, footer, toastBox)

  if (!IS_DEMO) {
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
    const t = el('div', `toast ${kind}`, message)
    toastBox.append(t)
    setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4000)
  }

  return {
    view,
    setHeader(ctx, list) {
      context.textContent = ctx ? `(${ctx})` : ''
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
    toast,
    pickFiles: () => pickFiles(),
  }
}

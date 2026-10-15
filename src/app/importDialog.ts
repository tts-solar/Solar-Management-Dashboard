import type { Imported, ImportResult } from './upload'
import type { MergeInfo } from './store'
import type { Plant } from '../data/types'

/**
 * Centered import flow: a modal that lets the user pick CSV files, SHOWS what will be imported
 * (per plant: date range, day count, skipped rows, and how it merges with existing data), and
 * only applies it once the user presses "ยืนยันนำเข้า". Replaces the old pick-and-apply-instantly
 * path so nothing changes on the dashboard before the user has seen and confirmed the preview.
 */
export interface ImportDialogOpts {
  /** Files already chosen (e.g. dropped onto the page); the dialog previews them straight away. */
  initialFiles?: File[]
  /** Parse files into plants for preview (nothing is applied). */
  read(files: File[]): Promise<ImportResult>
  /** How this parsed plant would combine with the data already loaded (added / replaced / merged). */
  previewMerge(plant: Plant): MergeInfo
  /** Apply the confirmed import. */
  onConfirm(ok: Imported[]): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const csvOnly = (list: FileList | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')

/** One-line summary of how a file's data lands on the dashboard, from its {@link MergeInfo}. */
function impact(info: MergeInfo): string {
  if (info.action === 'merged') {
    return `รวมกับข้อมูลเดิม — เพิ่ม ${info.added} วันใหม่ (เดิม ${info.kept} วัน → รวม ${info.total} วัน)`
  }
  if (info.action === 'replaced') return `แทนที่ข้อมูลตัวอย่าง — ${info.total} วัน`
  return `Plant ใหม่ — ${info.total} วัน`
}

export function openImportDialog(o: ImportDialogOpts): void {
  const dlg = el('dialog', 'import-dlg')
  dlg.setAttribute('aria-label', 'นำเข้าข้อมูล')

  const head = el('div', 'imp-head')
  head.append(
    el('h2', '', 'นำเข้าข้อมูล'),
    el('p', 'imp-sub', 'เลือกไฟล์ CSV ของ Plant — ระบบจะแสดงข้อมูลที่อ่านได้ก่อน แล้วค่อยกดยืนยัน (เลือกหลายไฟล์พร้อมกันได้)'),
  )

  const pick = el('button', 'c-btn primary imp-pick', 'เลือกไฟล์ CSV')
  pick.type = 'button'
  const input = el('input')
  input.type = 'file'
  input.accept = '.csv,text/csv'
  input.multiple = true
  input.hidden = true

  const preview = el('div', 'imp-preview')
  const status = el('p', 'imp-status', 'ยังไม่ได้เลือกไฟล์')
  preview.append(status)

  const actions = el('div', 'confirm-actions')
  const cancel = el('button', 'c-btn ghost', 'ยกเลิก')
  cancel.type = 'button'
  const ok = el('button', 'c-btn primary', 'ยืนยันนำเข้า')
  ok.type = 'button'
  ok.disabled = true
  actions.append(cancel, ok)

  dlg.append(head, pick, input, preview, actions)
  document.body.append(dlg)

  let confirmed: Imported[] = []

  function close(): void {
    if (dlg.open) dlg.close()
    dlg.remove()
  }

  async function process(files: File[]): Promise<void> {
    confirmed = []
    ok.disabled = true
    preview.replaceChildren(el('p', 'imp-status', `กำลังอ่าน ${files.length} ไฟล์…`))
    const { ok: imported, errors } = await o.read(files)
    confirmed = imported
    preview.replaceChildren()

    for (const im of imported) {
      const info = o.previewMerge(im.plant)
      const row = el('div', 'imp-row')
      row.append(el('span', 'imp-plant', `Plant ${im.plant.id}`))
      const meta = el('div', 'imp-meta')
      meta.append(
        el('span', '', `${info.from || '—'} ถึง ${info.to || '—'} · ${im.days} วันในไฟล์`),
        el('span', 'imp-change', impact(info)),
      )
      if (im.skipped) meta.append(el('span', 'imp-skip', `ข้ามแถวที่อ่านไม่ได้ ${im.skipped} แถว`))
      row.append(meta)
      preview.append(row)
    }
    for (const e of errors) preview.append(el('div', 'imp-row error', e))

    if (!imported.length && !errors.length) preview.append(el('p', 'imp-status', 'ไม่พบไฟล์ CSV'))
    ok.disabled = confirmed.length === 0
    if (confirmed.length) ok.focus()
  }

  pick.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const files = csvOnly(input.files)
    input.value = '' // allow re-picking the same file
    if (files.length) void process(files)
  })
  cancel.addEventListener('click', close)
  ok.addEventListener('click', () => {
    const toApply = confirmed
    close()
    if (toApply.length) o.onConfirm(toApply)
  })
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault() // Esc → cancel, we clean up ourselves
    close()
  })
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close() // click the dark backdrop
  })

  dlg.showModal()
  if (o.initialFiles?.length) void process(o.initialFiles)
  else pick.focus()
}

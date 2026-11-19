import type { Imported, ImportResult } from './upload'
import type { MergeInfo } from './store'
import type { Plant } from '../data/types'
import { downloadDailyTemplate, downloadMonthlyTemplate } from './templates'

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
  /** How this parsed plant would combine with the data already loaded (added / replaced / merged).
   *  `overwrite` mirrors the dialog's own checkbox, so the preview counts match what will happen. */
  previewMerge(plant: Plant, overwrite: boolean): MergeInfo
  /** Apply the confirmed import, with the overwrite choice the user made in the preview. */
  onConfirm(ok: Imported[], overwrite: boolean): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const supportedFiles = (list: FileList | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => /\.(csv|xlsx)$/i.test(f.name) || f.type === 'text/csv')

/** One-line summary of how a file's data lands on the dashboard, from its {@link MergeInfo}. */
function impact(info: MergeInfo, unit: string): string {
  if (info.action !== 'merged') return `Plant ใหม่ — ${info.total} ${unit}`
  const what = [`เพิ่ม ${info.added} ${unit}ใหม่`]
  if (info.replaced) what.push(`ทับของเดิม ${info.replaced} ${unit}`)
  return `รวมกับข้อมูลเดิม — ${what.join(' · ')} (เดิม ${info.kept} ${unit} → รวม ${info.total} ${unit})`
}

export function openImportDialog(o: ImportDialogOpts): void {
  const dlg = el('dialog', 'import-dlg')
  dlg.setAttribute('aria-label', 'นำเข้าข้อมูล')

  const head = el('div', 'imp-head')
  head.append(
    el('h2', '', 'นำเข้าข้อมูล'),
    el('p', 'imp-sub', 'เลือกไฟล์ CSV (ราย 15 นาที) หรือรายงานรายเดือน (Excel .xlsx หรือ CSV) ของ Plant — ระบบจะแสดงข้อมูลที่อ่านได้ก่อน แล้วค่อยกดยืนยัน (เลือกหลายไฟล์พร้อมกันได้)'),
  )

  const pick = el('button', 'c-btn primary imp-pick', 'เลือกไฟล์ CSV / Excel')
  pick.type = 'button'
  const input = el('input')
  input.type = 'file'
  input.accept = '.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  input.multiple = true
  input.hidden = true

  const preview = el('div', 'imp-preview')
  const status = el('p', 'imp-status', 'ยังไม่ได้เลือกไฟล์')
  preview.append(status)

  // Shown only when a file carries dates the dashboard already has. Hidden the rest of the time so
  // the common case (fresh months) stays a two-step flow.
  const dupe = el('label', 'imp-overwrite')
  const dupeBox = el('input')
  dupeBox.type = 'checkbox'
  dupe.append(dupeBox, el('span', 'imp-overwrite-label', 'ทับข้อมูลเดิมที่ซ้ำกันด้วยไฟล์ใหม่'))
  const dupeHint = el('span', 'imp-overwrite-hint', '')
  dupe.append(dupeHint)
  dupe.hidden = true

  const actions = el('div', 'confirm-actions')
  const cancel = el('button', 'c-btn ghost', 'ยกเลิก')
  cancel.type = 'button'
  const ok = el('button', 'c-btn primary', 'ยืนยันนำเข้า')
  ok.type = 'button'
  ok.disabled = true
  actions.append(cancel, ok)

  const tools = el('div', 'imp-tools')
  tools.append(el('span', 'imp-tools-hint', 'ยังไม่มีไฟล์? ดาวน์โหลดเทมเพลตไปกรอกเอง (เปลี่ยนชื่อไฟล์เป็นชื่อ Plant ของคุณก่อนนำเข้า):'))
  const tplMonth = el('button', 'c-btn ghost imp-tpl', 'เทมเพลตรายเดือน (CSV)')
  tplMonth.type = 'button'
  tplMonth.addEventListener('click', () => downloadMonthlyTemplate())
  const tplDay = el('button', 'c-btn ghost imp-tpl', 'ตัวอย่างรายวัน (CSV)')
  tplDay.type = 'button'
  tplDay.addEventListener('click', () => downloadDailyTemplate())
  tools.append(tplMonth, tplDay)

  dlg.append(head, pick, input, tools, preview, dupe, actions)
  document.body.append(dlg)

  let confirmed: Imported[] = []
  let errors: string[] = []
  // the checkbox changes every count in the preview, so the rows are drawn from stored parse
  // results rather than straight off the read — ticking it redraws, it does not re-read the files
  let overwrite = false

  function close(): void {
    if (dlg.open) dlg.close()
    dlg.remove()
  }

  function render(): void {
    preview.replaceChildren()
    let overlapping = 0

    for (const im of confirmed) {
      const unit = im.granularity === 'month' ? 'เดือน' : 'วัน'
      const info = o.previewMerge(im.plant, overwrite)
      // dates the file carries that the dashboard already has — `added` counts only the new ones,
      // in either mode, so the difference is the overlap whether or not the box is ticked
      overlapping += im.plant.daily.length - info.added
      const row = el('div', 'imp-row')
      row.append(el('span', 'imp-plant', `Plant ${im.plant.id}`))
      const meta = el('div', 'imp-meta')
      meta.append(
        el('span', '', `${info.from || '—'} ถึง ${info.to || '—'} · ${im.days} ${unit}ในไฟล์`),
        el('span', 'imp-change', impact(info, unit)),
      )
      if (im.blank) meta.append(el('span', 'imp-note', `ข้าม${unit}ที่ไม่มีตัวเลขในไฟล์ ${im.blank} ${unit}`))
      if (im.skipped) meta.append(el('span', 'imp-skip', `ข้ามแถวที่อ่านไม่ได้ ${im.skipped} แถว`))
      row.append(meta)
      preview.append(row)
    }
    for (const e of errors) preview.append(el('div', 'imp-row error', e))
    if (!confirmed.length && !errors.length) preview.append(el('p', 'imp-status', 'ไม่พบไฟล์ CSV หรือ Excel (.xlsx)'))

    dupe.hidden = overlapping === 0
    dupeHint.textContent = overlapping
      ? `ไฟล์มีข้อมูลซ้ำกับของเดิม ${overlapping} รายการ · ถ้าไม่ติ๊ก ระบบจะเก็บของเดิมไว้`
      : ''
    ok.disabled = confirmed.length === 0
  }

  async function process(files: File[]): Promise<void> {
    confirmed = []
    errors = []
    ok.disabled = true
    dupe.hidden = true
    preview.replaceChildren(el('p', 'imp-status', `กำลังอ่าน ${files.length} ไฟล์…`))
    const read = await o.read(files)
    confirmed = read.ok
    errors = read.errors
    render()
    if (confirmed.length) ok.focus()
  }

  dupeBox.addEventListener('change', () => {
    overwrite = dupeBox.checked
    render()
  })

  pick.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const files = supportedFiles(input.files)
    input.value = '' // allow re-picking the same file
    if (files.length) void process(files)
  })
  cancel.addEventListener('click', close)
  ok.addEventListener('click', () => {
    const toApply = confirmed
    const replace = overwrite
    close()
    if (toApply.length) o.onConfirm(toApply, replace)
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

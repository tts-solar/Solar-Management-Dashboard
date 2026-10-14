/** Settings page: the one place to import files and adjust settings (replaces the old header buttons). */

export interface SettingsPageCtx {
  isDemo: boolean
  hasPlants: boolean
  /** Open the CSV file picker (offline only). */
  onImport(): void
  /** Open the per-plant settings dialog. */
  onPlantSettings(): void
  /** Offline: save a portable copy with the loaded data · Demo: fetch the blank offline app. */
  onDownload(): void
  /** Offline: wipe the data this browser auto-remembered. */
  onClear(): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function card(title: string, desc: string, action: HTMLButtonElement, extra = ''): HTMLElement {
  const c = el('section', `setting-card ${extra}`.trim())
  c.append(el('h3', '', title), el('p', '', desc), action)
  return c
}

const UPLOAD_IC = '<path d="M12 16V4M8 8l4-4 4 4M5 20h14"/>'

function button(text: string, cls: string, onClick: () => void, icon?: string): HTMLButtonElement {
  const b = el('button', `set-btn ${cls}`)
  b.type = 'button'
  if (icon) {
    const s = el('span', 'set-ic')
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`
    b.append(s)
  }
  b.append(document.createTextNode(text))
  b.addEventListener('click', onClick)
  return b
}

export function renderSettings(view: HTMLElement, ctx: SettingsPageCtx): void {
  const page = el('section', 'settings-page')
  page.append(el('p', 'settings-intro', 'นำเข้าไฟล์ข้อมูลและปรับค่าต่างๆ ได้จากหน้านี้'))

  const cards = el('div', 'setting-cards')

  if (!ctx.isDemo) {
    cards.append(
      card(
        'นำเข้าข้อมูล',
        'เลือกไฟล์ CSV ของแต่ละ Plant (เลือกหลายไฟล์พร้อมกันได้) หรือจะลากไฟล์มาวางบนหน้าไหนก็ได้',
        button('นำเข้าไฟล์ CSV', 'primary big', ctx.onImport, UPLOAD_IC),
        'featured',
      ),
    )
  }

  cards.append(
    card(
      'ตั้งค่า Plant',
      ctx.hasPlants
        ? 'แก้ชื่อที่แสดง ขนาดติดตั้ง ค่าไฟ เงินลงทุน และค่าสมมติต่างๆ ของแต่ละ Plant'
        : 'ยังไม่มี Plant — นำเข้าไฟล์ CSV ก่อนจึงจะตั้งค่าได้',
      button('เปิดการตั้งค่า Plant', 'primary', ctx.onPlantSettings),
    ),
  )

  cards.append(
    card(
      ctx.isDemo ? 'ดาวน์โหลดแอป Offline' : 'บันทึกไฟล์',
      ctx.isDemo
        ? 'ดาวน์โหลดแอปรุ่น Offline (ไฟล์เปล่า ไม่มีข้อมูล) ไปเปิดบนเครื่องแล้วใส่ข้อมูลจริงของคุณเอง'
        : 'บันทึกสำเนาพกพา (ไฟล์ HTML ไฟล์เดียวพร้อมข้อมูลในตัว) เปิดครั้งหน้าจะเห็นข้อมูลเดิม ไม่ต้องใช้อินเทอร์เน็ต',
      button(ctx.isDemo ? 'ดาวน์โหลดแอป Offline' : 'บันทึกไฟล์', 'primary', ctx.onDownload),
    ),
  )

  if (!ctx.isDemo) {
    cards.append(
      card(
        'ล้างข้อมูล',
        'ลบข้อมูลที่เบราว์เซอร์นี้จำไว้ทั้งหมด (ไฟล์ที่กด "บันทึกไฟล์" ไว้แล้วจะไม่ถูกลบ) — เหมาะกับก่อนส่งต่อเครื่องให้ผู้อื่น',
        button('ล้างข้อมูล', 'danger', ctx.onClear),
      ),
    )
  }

  page.append(cards)
  view.replaceChildren(page)
}

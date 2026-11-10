/** Offline build, no data yet: how to import, what the CSV must look like, and where the data stays. */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function list(tag: 'ol' | 'ul', items: string[]): HTMLElement {
  const l = el(tag)
  for (const t of items) l.append(el('li', '', t))
  return l
}

export function renderWelcome(view: HTMLElement, onPick: () => void): void {
  const box = el('section', 'welcome')
  box.append(el('h2', '', 'เริ่มใช้งาน Solar Dashboard (Offline)'))

  box.append(
    list('ol', [
      'นำเข้าไฟล์ของแต่ละ Plant ด้วยปุ่ม "เลือกไฟล์ CSV / Excel" ด้านล่าง หรือลากไฟล์มาวางบนหน้านี้ (เลือกหลายไฟล์พร้อมกันได้) · รองรับ CSV ราย 15 นาที และ Excel (.xlsx) รายงานรายเดือน · ครั้งต่อไปนำเข้าเพิ่มได้ที่เมนู "Settings" ด้านซ้าย',
      'ดูหน้าภาพรวม แล้วคลิกเข้าไปดูราย Plant รายปี และรายเดือน · ปรับค่าของแต่ละ Plant ได้ที่เมนู "Settings" ด้านซ้าย',
      'แอปจำข้อมูลที่นำเข้าไว้ในเบราว์เซอร์เครื่องนี้ให้อัตโนมัติ เปิดไฟล์เดิมครั้งหน้าก็เห็นข้อมูลเดิมทันที ไม่ต้องนำเข้าใหม่ · อยากได้สำเนาพกพาไปเครื่องอื่น หรืออยากลบข้อมูลที่จำไว้ ไปที่เมนู "Settings" ด้านซ้าย',
    ]),
  )

  const pick = el('button', 'welcome-pick', 'เลือกไฟล์ CSV / Excel')
  pick.type = 'button'
  pick.addEventListener('click', onPick)
  box.append(pick)

  const fmt = el('div', 'welcome-box')
  fmt.append(
    el('h3', '', 'รูปแบบไฟล์ CSV'),
    list('ul', [
      'ชื่อไฟล์: ข้อความก่อนเครื่องหมาย "_" คือชื่อ Plant เช่น MH_15 นาที.csv → Plant MH',
      'คอลัมน์ที่ต้องมี: Date/Time และ Energy Produced (Wh)',
      'คอลัมน์เสริม: Energy Consumed, Exported to Grid, Imported from Grid',
      'วันที่แบบ MM/DD/YYYY HH:mm (เช่น 12/01/2025 00:15) หรือ YYYY-MM-DD HH:mm · หน่วย Wh (หัวคอลัมน์ที่มี kWh หรือ MWh จะแปลงให้)',
      'ไฟล์ภาษาไทยได้ทั้ง UTF-8 และ Windows-874',
    ]),
  )
  box.append(fmt)

  const xlsx = el('div', 'welcome-box')
  xlsx.append(
    el('h3', '', 'รูปแบบไฟล์ Excel (.xlsx) — รายงานรายเดือน'),
    list('ul', [
      'รายงาน "Plant Report" จากพอร์ทัล (หนึ่งแถวต่อหนึ่งเดือน) · ชื่อ Plant มาจากชื่อไฟล์ เช่น "Plant Report - SC Tower 2024.xlsx" → Plant SC Tower',
      'คอลัมน์ที่ใช้: Statistical Period (YYYY-MM), PV Yield → ผลิต, Consumption → ใช้ไฟ, Export → ขายไฟ, Import → ซื้อไฟ, Peak Power → กำลังสูงสุด',
      'ข้อมูลเป็นระดับ "รายเดือน" — กราฟรายเดือน/รายปีจะแม่นยำ ส่วนมุมมองรายวันจะเห็นหนึ่งจุดต่อเดือน (ตามความละเอียดของรายงาน)',
      'นำเข้าหลายปีพร้อมกันได้ ระบบรวมเป็น Plant เดียวกันให้อัตโนมัติ',
    ]),
  )
  box.append(xlsx)

  box.append(
    el(
      'p',
      'welcome-privacy',
      'ข้อมูลอยู่ในเครื่องของคุณเท่านั้น — ไฟล์นี้ถูกตั้งให้ห้ามเชื่อมต่ออินเทอร์เน็ต ข้อมูลจึงไม่ถูกส่งออกไปที่ใด · แอปจำข้อมูลไว้ในเบราว์เซอร์เครื่องนี้ ถ้าใช้เครื่องร่วมกับผู้อื่นให้กดปุ่ม "ล้างข้อมูล" ก่อนเลิกใช้',
    ),
  )
  view.replaceChildren(box)
}

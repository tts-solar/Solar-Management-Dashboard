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
      'นำเข้าไฟล์ CSV ของแต่ละ Plant ด้วยปุ่ม "นำเข้า CSV" ด้านบน หรือลากไฟล์มาวางบนหน้านี้ (เลือกหลายไฟล์พร้อมกันได้)',
      'ดูหน้าภาพรวม แล้วคลิกเข้าไปดูราย Plant รายปี และรายเดือน · ปรับค่าของแต่ละ Plant ได้ที่ปุ่ม "ตั้งค่า"',
      'กด "บันทึกไฟล์" เพื่อเก็บไฟล์ HTML ที่มีข้อมูลอยู่ข้างใน เปิดไฟล์นั้นครั้งหน้าก็เห็นข้อมูลและค่าที่ตั้งไว้เหมือนเดิม',
    ]),
  )

  const pick = el('button', 'welcome-pick', 'เลือกไฟล์ CSV')
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

  box.append(
    el(
      'p',
      'welcome-privacy',
      'ข้อมูลอยู่ในเครื่องของคุณเท่านั้น — ไฟล์นี้ถูกตั้งให้ห้ามเชื่อมต่ออินเทอร์เน็ต ข้อมูลจึงไม่ถูกส่งออกไปที่ใด',
    ),
  )
  view.replaceChildren(box)
}

/** No data yet (either build): how to import, what the files must look like, and where the data stays.
 *  Button names here must match the sidebar labels in app/shell.ts — they are what the user looks for. */

import { downloadDailyTemplate, downloadMonthlyTemplate } from '../app/templates'

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
  // No "(Offline)" in the heading: this screen renders in BOTH builds whenever there is no data yet.
  box.append(el('h2', '', 'เริ่มใช้งาน Solar Dashboard'))

  box.append(
    list('ol', [
      'นำเข้าไฟล์ของแต่ละ Plant ด้วยปุ่ม "เลือกไฟล์ CSV / Excel" ด้านล่าง หรือลากไฟล์มาวางบนหน้านี้ (เลือกหลายไฟล์พร้อมกันได้) · รองรับ CSV ราย 15 นาที และ Excel (.xlsx) รายงานรายเดือน · ครั้งต่อไปนำเข้าเพิ่มได้ที่ปุ่ม "Import Data" ในแถบเมนูด้านซ้าย',
      'ดูหน้าภาพรวม แล้วคลิกเข้าไปดูราย Plant รายปี และรายเดือน · ปรับค่าของแต่ละ Plant ได้ที่ปุ่ม "Plant Settings" ในแถบเมนูด้านซ้าย',
      'แอปจำข้อมูลที่นำเข้าไว้ในเบราว์เซอร์เครื่องนี้ให้อัตโนมัติ เปิดไฟล์เดิมครั้งหน้าก็เห็นข้อมูลเดิมทันที ไม่ต้องนำเข้าใหม่ · อยากได้สำเนาพกพาไปเครื่องอื่นกดปุ่ม "Save File" · อยากลบข้อมูลที่จำไว้กดปุ่ม "Clear Data" — ทั้งสองปุ่มอยู่ในแถบเมนูด้านซ้าย',
    ]),
  )

  const pick = el('button', 'welcome-pick', 'เลือกไฟล์ CSV / Excel')
  pick.type = 'button'
  pick.addEventListener('click', onPick)
  box.append(pick)

  const tpl = el('div', 'welcome-tpl')
  tpl.append(el('span', '', 'ไม่มีไฟล์ส่งออกจากพอร์ทัล? ดาวน์โหลดเทมเพลตไปกรอกเอง (เปลี่ยนชื่อไฟล์เป็นชื่อ Plant ก่อนนำเข้า): '))
  const tplMonth = el('button', 'c-btn ghost', 'เทมเพลตรายเดือน (CSV)')
  tplMonth.type = 'button'
  tplMonth.addEventListener('click', () => downloadMonthlyTemplate())
  const tplDay = el('button', 'c-btn ghost', 'ตัวอย่างรายวัน (CSV)')
  tplDay.type = 'button'
  tplDay.addEventListener('click', () => downloadDailyTemplate())
  tpl.append(tplMonth, tplDay)
  box.append(tpl)

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
    el('h3', '', 'รูปแบบไฟล์รายงานรายเดือน (Excel .xlsx หรือ CSV)'),
    list('ul', [
      'รายงาน "Plant Report" จากพอร์ทัล (หนึ่งแถวต่อหนึ่งเดือน) รับได้ทั้ง .xlsx และ .csv · ชื่อ Plant มาจากชื่อไฟล์ เช่น "Plant Report - SC Tower 2024.xlsx" → Plant SC Tower',
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
      'ข้อมูลอยู่ในเครื่องของคุณเท่านั้น — แอปนี้ถูกตั้งให้ห้ามเชื่อมต่ออินเทอร์เน็ต ข้อมูลจึงไม่ถูกส่งออกไปที่ใด · แอปจำข้อมูลไว้ในเบราว์เซอร์เครื่องนี้ ถ้าใช้เครื่องร่วมกับผู้อื่นให้กดปุ่ม "Clear Data" ก่อนเลิกใช้',
    ),
  )
  view.replaceChildren(box)
}

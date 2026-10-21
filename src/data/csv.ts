import type { DailyRow, DayProfile, ParseResult } from './types'
import { daysInMonth, pad } from './aggregate'

/** Thrown for files the dashboard cannot read; the message is shown to the user. */
export class CsvError extends Error {}

type Col = 'date' | 'produced' | 'consumed' | 'exported' | 'imported'

// each header cell takes the first still-free column it matches
const COLUMNS: Array<[Col, RegExp]> = [
  ['date', /date|time|วันที่|เวลา/i],
  ['produced', /produc|generat|ผลิต/i],
  ['consumed', /consum|load|ใช้ไฟ/i],
  ['exported', /export|ขายไฟ|ส่งออก/i],
  ['imported', /import|ซื้อไฟ|นำเข้า/i],
]

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/

export interface Stamp {
  date: string // YYYY-MM-DD
  minute: number // minutes since midnight
}

const unquote = (s: string): string => s.trim().replace(/^"(.*)"$/, '$1')

/**
 * Parse "MM/DD/YYYY HH:mm" (US order, as the monitoring portal exports) or ISO "YYYY-MM-DD HH:mm".
 * Never uses Date(string): that is locale-dependent and swaps day/month.
 */
export function parseStamp(raw: string): Stamp | null {
  const s = unquote(raw)
  const us = US_DATE.exec(s)
  const g = us ?? ISO_DATE.exec(s)
  if (!g) return null
  const [y, m, d] = us ? [+g[3], +g[1], +g[2]] : [+g[1], +g[2], +g[3]]
  const hh = g[4] ? +g[4] : 0
  const mm = g[5] ? +g[5] : 0
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || hh > 23 || mm > 59) return null
  return { date: `${y}-${pad(m)}-${pad(d)}`, minute: hh * 60 + mm }
}

function splitLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function unitFactor(header: string): number {
  if (/\bmwh\b/i.test(header)) return 1000
  if (/\bkwh\b/i.test(header)) return 1
  return 0.001 // portal exports Wh
}

/** Plant id from a file name: "MH_15 นาที ราย 6 เดือน.csv" → "MH", "sample-MH.csv" → "MH". */
export function plantIdFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/^sample[-_ ]*/i, '')
  return base.split('_')[0].trim() || 'Plant'
}

/** Fold a 15-min (or any interval) export into daily kWh totals. */
export function parseCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const idx = new Map<Col, number>()
  const factor = new Map<Col, number>()
  splitLine(lines[0] ?? '').forEach((h, i) => {
    const hit = COLUMNS.find(([c, re]) => !idx.has(c) && re.test(h))
    if (hit) {
      idx.set(hit[0], i)
      factor.set(hit[0], unitFactor(h))
    }
  })
  const dateCol = idx.get('date')
  if (dateCol === undefined || !idx.has('produced'))
    throw new CsvError('ไม่พบคอลัมน์ Date/Time หรือ Energy Produced ในไฟล์ CSV')

  const value = (cells: string[], c: Col): number => {
    const i = idx.get(c)
    if (i === undefined) return 0
    const v = Number(unquote(cells[i] ?? ''))
    return Number.isFinite(v) ? v * (factor.get(c) ?? 1) : 0
  }

  const days = new Map<string, DailyRow>()
  // sum of each column per time-of-day slot (+ how many days contributed) → averaged into a day shape
  type Slot = { produced: number; consumed: number; exported: number; imported: number; n: number }
  const slots = new Map<number, Slot>()
  const gaps = new Map<number, number>()
  let gapSamples = 0
  let rows = 0
  let skipped = 0
  let clamped = 0
  let minProduced = Infinity
  let first = ''
  let last = ''
  let prev: Stamp | null = null

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cells = splitLine(line)
    const st = parseStamp(cells[dateCol] ?? '')
    if (!st) {
      skipped++
      continue
    }
    rows++
    const key = `${st.date} ${pad(Math.floor(st.minute / 60))}:${pad(st.minute % 60)}`
    if (!first || key < first) first = key
    if (key > last) last = key
    if (prev && prev.date === st.date && st.minute > prev.minute && gapSamples < 500) {
      const g = st.minute - prev.minute
      gaps.set(g, (gaps.get(g) ?? 0) + 1)
      gapSamples++
    }
    prev = st

    const e = {
      produced: value(cells, 'produced'),
      consumed: value(cells, 'consumed'),
      exported: value(cells, 'exported'),
      imported: value(cells, 'imported'),
    }
    // negative energy is meaningless in any column (standby draw, meter noise) → count and zero it
    for (const k of Object.keys(e) as Array<keyof typeof e>) {
      if (e[k] < 0) {
        clamped++
        e[k] = 0
      }
    }
    minProduced = Math.min(minProduced, e.produced)

    let day = days.get(st.date)
    if (!day) {
      day = { date: st.date, produced: 0, consumed: 0, exported: 0, imported: 0, peakKw: 0, samples: 0 }
      days.set(st.date, day)
    }
    day.produced += e.produced
    day.consumed += e.consumed
    day.exported += e.exported
    day.imported += e.imported
    day.samples++
    day.peakKw = Math.max(day.peakKw, e.produced) // interval kWh for now, converted to kW below

    let slot = slots.get(st.minute)
    if (!slot) {
      slot = { produced: 0, consumed: 0, exported: 0, imported: 0, n: 0 }
      slots.set(st.minute, slot)
    }
    slot.produced += e.produced
    slot.consumed += e.consumed
    slot.exported += e.exported
    slot.imported += e.imported
    slot.n++
  }
  if (!rows) throw new CsvError('ไม่พบข้อมูลในไฟล์ CSV (รูปแบบวันที่ต้องเป็น MM/DD/YYYY HH:mm)')

  // most common spacing between readings = the logging interval
  let intervalMin = 15
  let seen = 0
  for (const [g, n] of gaps) {
    if (n > seen) {
      intervalMin = g
      seen = n
    }
  }

  const daily = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const d of daily) d.peakKw = (d.peakKw * 60) / intervalMin

  // average each slot into a representative day (sorted by time), so the advisor sees flow timing
  const profile: DayProfile = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, s]) => ({
      minute,
      produced: s.produced / s.n,
      consumed: s.consumed / s.n,
      exported: s.exported / s.n,
      imported: s.imported / s.n,
    }))

  return { daily, profile, rows, skipped, clamped, minProduced, intervalMin, first, last }
}

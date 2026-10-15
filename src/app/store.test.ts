import { describe, expect, it } from 'vitest'
import type { DailyRow, Plant } from '../data/types'
import { applyMerge, mergeInfo } from './store'

/** A day row tagged via `produced`, so we can tell an existing row from an incoming one at the same date. */
const day = (date: string, produced = 1): DailyRow => ({
  date,
  produced,
  consumed: 0,
  exported: 0,
  imported: 0,
  peakKw: 0,
  samples: 1,
})
const plant = (id: string, dates: string[], produced = 1, source = `${id}.csv`): Plant => ({
  id,
  name: id,
  daily: dates.map((d) => day(d, produced)),
  source,
})
const dates = (p: Plant): string[] => p.daily.map((d) => d.date)

describe('mergeInfo — preview of an import (pure, no mutation)', () => {
  it('reports a brand-new plant as "added"', () => {
    const info = mergeInfo(undefined, plant('KK', ['2026-01-01', '2026-01-02']))
    expect(info).toMatchObject({ action: 'added', added: 2, kept: 0, total: 2, from: '2026-01-01', to: '2026-01-02' })
  })

  it('reports a sample plant as "replaced" wholesale', () => {
    const existing = plant('MH', ['2026-01-01'], 1, 'sample-MH.csv')
    const info = mergeInfo(existing, plant('MH', ['2026-02-01', '2026-02-02']))
    expect(info).toMatchObject({ action: 'replaced', added: 2, kept: 0, total: 2 })
  })

  it('reports only the new dates as added for a real-plant merge', () => {
    const existing = plant('MH', ['2026-01-01', '2026-01-02', '2026-01-03']) // "months 1..3"
    const info = mergeInfo(existing, plant('MH', ['2026-01-03', '2026-01-04', '2026-01-05'])) // "3..5", 3 overlaps
    expect(info).toMatchObject({ action: 'merged', incomingDays: 3, added: 2, kept: 3, total: 5 })
  })

  it('does not mutate the existing plant', () => {
    const existing = plant('MH', ['2026-01-01'])
    mergeInfo(existing, plant('MH', ['2026-01-02']))
    expect(dates(existing)).toEqual(['2026-01-01'])
  })
})

describe('applyMerge — keep existing days, append only new dates', () => {
  it('stitches months 1-5 then 3-12 into one sorted 1-12 span', () => {
    const list: Plant[] = [plant('MH', ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((m) => `${m}-01`))]
    const incoming = plant('MH', ['03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `2026-${m}-01`))
    const info = applyMerge(list, incoming)

    expect(info.action).toBe('merged')
    expect(info.added).toBe(7) // months 6-12
    expect(info.total).toBe(12)
    expect(dates(list[0])).toEqual([...Array(12)].map((_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`))
    expect(info.from).toBe('2026-01-01')
    expect(info.to).toBe('2026-12-01')
  })

  it('keeps the EXISTING row when a date overlaps (new file never overwrites)', () => {
    const list: Plant[] = [plant('MH', ['2026-01-01'], 111)] // existing produced = 111
    applyMerge(list, plant('MH', ['2026-01-01', '2026-01-02'], 999)) // incoming produced = 999
    const jan1 = list[0].daily.find((d) => d.date === '2026-01-01')!
    expect(jan1.produced).toBe(111) // existing kept, not clobbered
    expect(list[0].daily.find((d) => d.date === '2026-01-02')!.produced).toBe(999) // new date taken from file
  })

  it('replaces a sample plant wholesale but merges a real one', () => {
    const list: Plant[] = [plant('MH', ['2026-01-01'], 1, 'sample-MH.csv')]
    applyMerge(list, plant('MH', ['2026-02-01'], 2, 'MH.csv'))
    expect(dates(list[0])).toEqual(['2026-02-01']) // sample dropped, not merged
    expect(list[0].source).toBe('MH.csv')
  })

  it('adds a new plant id and keeps the list id-sorted', () => {
    const list: Plant[] = [plant('MH', ['2026-01-01'])]
    const info = applyMerge(list, plant('KK', ['2026-01-01']))
    expect(info.action).toBe('added')
    expect(list.map((p) => p.id)).toEqual(['KK', 'MH'])
  })
})

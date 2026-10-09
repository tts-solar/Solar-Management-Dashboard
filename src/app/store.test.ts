import { describe, expect, it } from 'vitest'
import type { Plant } from '../data/types'
import { clearStored, loadPlants, parsePlants, savePlants, scopedStorage } from './store'

const plant = (id: string): Plant => ({
  id,
  name: id,
  daily: [{ date: '2025-01-01', produced: 1, consumed: 2, exported: 0, imported: 2, peakKw: 0.5, samples: 96 }],
  source: `${id}.csv`,
})

/** A tiny in-memory Storage-like KV for the persistence helpers. */
function fakeKV() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('parsePlants', () => {
  it('round-trips a valid plants array', () => {
    const plants = [plant('A'), plant('B')]
    expect(parsePlants(JSON.stringify(plants))).toEqual(plants)
  })
  it('rejects malformed input → null', () => {
    expect(parsePlants('garbage')).toBeNull()
    expect(parsePlants(null)).toBeNull()
    expect(parsePlants(JSON.stringify([{ id: 'X' }]))).toBeNull() // no daily rows
    expect(parsePlants(JSON.stringify({ not: 'an array' }))).toBeNull()
  })
})

describe('savePlants / loadPlants', () => {
  it('saves then loads the same plants', () => {
    const kv = fakeKV()
    expect(savePlants([plant('A'), plant('B')], kv)).toBe(true)
    expect(loadPlants(kv)).toEqual([plant('A'), plant('B')])
  })
  it('loadPlants is [] when nothing stored or storage is null', () => {
    expect(loadPlants(fakeKV())).toEqual([])
    expect(loadPlants(null)).toEqual([])
  })
  it('savePlants returns false when storage is null', () => {
    expect(savePlants([plant('A')], null)).toBe(false)
  })
  it('savePlants returns false when setItem throws (quota full)', () => {
    const kv = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('quota') } }
    expect(savePlants([plant('A')], kv)).toBe(false)
  })
})

describe('clearStored', () => {
  it('forgets the remembered plants', () => {
    const kv = fakeKV()
    savePlants([plant('A')], kv)
    clearStored(kv)
    expect(loadPlants(kv)).toEqual([])
  })
})

describe('scopedStorage isolates by suffix (two files do not cross-see)', () => {
  it('a plant saved under one path is invisible under another path', () => {
    const backing = new Map<string, string>()
    const ls = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    }
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
    try {
      const a = scopedStorage(':/folder/a.html')!
      const b = scopedStorage(':/folder/b.html')!
      savePlants([plant('A')], a)
      expect(loadPlants(b)).toEqual([]) // b cannot see a's data
      expect(loadPlants(a)).toEqual([plant('A')])
    } finally {
      if (orig) Object.defineProperty(globalThis, 'localStorage', orig)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})

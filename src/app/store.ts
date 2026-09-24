import type { SettingsMap } from '../data/settings'
import type { DailyRow, Plant } from '../data/types'

/**
 * App data that travels inside a downloaded HTML file: the plants (daily totals, never the raw CSV)
 * and their settings. The offline copy reads it back at startup instead of the sample data.
 */
export interface Snapshot {
  v: 1
  id: string // ISO time of the download; also scopes this file's own saved settings
  plants: Plant[]
  settings: SettingsMap
}

export const EMBED_ID = 'solar-data'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const NUM_FIELDS = ['produced', 'consumed', 'exported', 'imported', 'peakKw', 'samples'] as const
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function toDaily(v: unknown): DailyRow | null {
  if (!isObj(v) || typeof v.date !== 'string' || !DATE.test(v.date)) return null
  for (const k of NUM_FIELDS) if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) return null
  return v as unknown as DailyRow
}

function toPlant(v: unknown): Plant | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || !Array.isArray(v.daily)) return null
  const daily: DailyRow[] = []
  for (const d of v.daily) {
    const row = toDaily(d)
    if (!row) return null
    daily.push(row)
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return {
    id: v.id,
    name: typeof v.name === 'string' && v.name ? v.name : v.id,
    daily,
    source: typeof v.source === 'string' ? v.source : '',
  }
}

/** Validate embedded JSON; anything malformed → null so the app falls back to the sample data. */
export function parseSnapshot(text: string | null | undefined): Snapshot | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.plants)) return null
  const plants: Plant[] = []
  for (const p of raw.plants) {
    const plant = toPlant(p)
    if (!plant) return null
    plants.push(plant)
  }
  if (!plants.length) return null
  return {
    v: 1,
    id: typeof raw.id === 'string' ? raw.id : '',
    plants,
    settings: isObj(raw.settings) ? (raw.settings as SettingsMap) : {},
  }
}

/** Read and detach the embedded snapshot so the captured page HTML stays pristine. */
export function readEmbedded(doc: Document): Snapshot | null {
  const node = doc.getElementById(EMBED_ID)
  const snap = parseSnapshot(node?.textContent)
  node?.remove()
  return snap
}

/** Add a plant, or replace the one with the same id (e.g. the real MH replaces the sample MH). */
export function upsertPlant(list: Plant[], plant: Plant): 'added' | 'replaced' {
  const i = list.findIndex((p) => p.id === plant.id)
  if (i >= 0) {
    list[i] = plant
    return 'replaced'
  }
  list.push(plant)
  list.sort((a, b) => a.id.localeCompare(b.id))
  return 'added'
}

type KV = Pick<Storage, 'getItem' | 'setItem'>

/**
 * localStorage with every key suffixed. Each downloaded file keeps its own edits, so opening
 * an older file from the same folder is not overridden by a newer file's settings.
 */
export function scopedStorage(suffix: string): KV | null {
  let ls: Storage | null
  try {
    ls = globalThis.localStorage ?? null
  } catch {
    return null
  }
  if (!ls) return null
  const store = ls
  return {
    getItem: (k) => store.getItem(k + suffix),
    setItem: (k, v) => store.setItem(k + suffix, v),
  }
}

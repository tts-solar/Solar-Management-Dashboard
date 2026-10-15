import type { SettingsMap } from '../data/settings'
import type { DailyRow, Plant } from '../data/types'
import { idbDel, idbGetAll, idbOpen, idbPut, memKv } from './idb'

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

export type KV = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: Storage['removeItem'] }

/**
 * localStorage with every key suffixed. Each downloaded file keeps its own edits, so opening
 * an older file from the same folder is not overridden by a newer file's settings. A blank
 * offline file scopes by its own path, so two local files never cross-see each other's data.
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
    removeItem: (k) => store.removeItem(k + suffix),
  }
}

/** Where a blank offline file auto-remembers its imported plants (daily totals, never the raw CSV). */
export const PLANTS_KEY = 'solar-dashboard:plants:v1'

/** Validate a stored plants array; anything malformed → null so the app falls back to empty. */
export function parsePlants(text: string | null | undefined): Plant[] | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const plants: Plant[] = []
  for (const p of raw) {
    const plant = toPlant(p)
    if (!plant) return null
    plants.push(plant)
  }
  return plants
}

/** Read the auto-remembered plants for this file's scope ([] if none, malformed, or storage blocked). */
export function loadPlants(kv: KV | null): Plant[] {
  return parsePlants(kv?.getItem(PLANTS_KEY)) ?? []
}

/** Auto-remember the plants for this file's scope. Returns false if the browser cannot store them. */
export function savePlants(plants: Plant[], kv: KV | null): boolean {
  try {
    kv?.setItem(PLANTS_KEY, JSON.stringify(plants))
    return kv !== null
  } catch {
    return false // quota full or storage blocked (private mode, file:// policies)
  }
}

/** Forget the auto-remembered plants for this file's scope (the "ล้างข้อมูล" button). */
export function clearStored(kv: KV | null): void {
  try {
    kv?.removeItem?.(PLANTS_KEY)
  } catch {
    // ignore: nothing to forget if storage is blocked
  }
}

/** App key namespace — migration only copies these across, never a foreign site's localStorage keys. */
const APP_PREFIX = 'solar-dashboard'
/** Per-scope sentinel so the one-time localStorage→IndexedDB copy runs once and "ล้างข้อมูล" is not resurrected. */
const MIGRATED_KEY = 'solar-dashboard:migrated:v1'

/**
 * Open storage for a file scope, backed by IndexedDB (hundreds of MB) when available, else
 * localStorage (today's behavior — e.g. Firefox on file://). Returns the SAME synchronous KV
 * shape either way, so every caller stays unchanged. On first open of a scope it copies any
 * existing scoped localStorage data into IndexedDB once (returning customers keep their data).
 */
export async function openScopedStorage(suffix: string): Promise<KV | null> {
  const db = await idbOpen()
  if (!db) return scopedStorage(suffix) // no IndexedDB → localStorage, exactly as before
  const cache = await idbGetAll(db)
  if (!cache.has(MIGRATED_KEY + suffix)) {
    try {
      const ls = globalThis.localStorage
      if (ls) {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (k && k.startsWith(APP_PREFIX) && k.endsWith(suffix) && !cache.has(k)) {
            const v = ls.getItem(k)
            if (v != null) {
              cache.set(k, v)
              idbPut(db, k, v)
            }
          }
        }
      }
    } catch {
      // storage blocked — nothing to migrate
    }
    cache.set(MIGRATED_KEY + suffix, '1')
    idbPut(db, MIGRATED_KEY + suffix, '1')
  }
  return memKv(suffix, cache, { put: (k, v) => idbPut(db, k, v), del: (k) => idbDel(db, k) })
}

/** Used / total bytes the browser reports for this origin, or null when unsupported. For the storage meter. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await globalThis.navigator?.storage?.estimate?.()
    if (est && typeof est.usage === 'number' && typeof est.quota === 'number') {
      return { usage: est.usage, quota: est.quota }
    }
  } catch {
    // estimate() unsupported or blocked
  }
  return null
}

/** Per-plant assumptions. Real values are unknown yet, so every field is editable in the app. */
export interface PlantSettings {
  name: string | null // display name; null → plant id
  kWp: number | null // null → estimated from peak output
  sunHours: number // peak sun hours per day
  performanceRatio: number // 0..1
  peakTestKwhPerDay: number | null // null → simulate × peakTestFactor
  peakTestFactor: number
  abnormalBelow: number // efficiency fraction under which a period is flagged
  tariff: number // THB per kWh saved (months 1-6, or the whole year when tariffH2 is null)
  tariffH2: number | null // THB per kWh for months 7-12; null → tariff applies all year (no half-year split)
  startDate: string | null // commissioning date YYYY-MM-DD; null → first day of real data (auto)
  investment: number | null // THB; null → sized so the plan pays back in paybackPlanYears
  paybackPlanYears: number
  reinvestAge: number // years — the dashed "Age of Plant" line in the efficiency/age chart (global only, not per-plant)
}

export const DEFAULT_SETTINGS: PlantSettings = {
  name: null,
  kWp: null,
  sunHours: 4.5,
  performanceRatio: 0.8,
  peakTestKwhPerDay: null,
  peakTestFactor: 0.9,
  abnormalBelow: 0.7,
  tariff: 4.5,
  tariffH2: null,
  startDate: null,
  investment: null,
  paybackPlanYears: 7,
  reinvestAge: 12.5,
}

/** kWp estimate = highest interval-average kW ÷ this ratio. */
export const PEAK_TO_KWP = 0.8

export type SettingsMap = Record<string, Partial<PlantSettings>>
type KV = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: Storage['removeItem'] }

/**
 * Reserved SettingsMap key for the system-wide (global) defaults layer. A real plant id can never
 * equal it: ids come from plantIdFromFile(), which takes base.split('_')[0], so no id ever contains
 * an underscore. An older file/storage without this key resolves exactly as before (backward compat).
 */
export const GLOBAL_KEY = '__global__'

const STORAGE_KEY = 'solar-dashboard:settings:v1'
const NUMERIC = ['sunHours', 'performanceRatio', 'peakTestFactor', 'abnormalBelow', 'tariff', 'paybackPlanYears', 'reinvestAge'] as const
const OPTIONAL = ['kWp', 'peakTestKwhPerDay', 'investment', 'tariffH2'] as const

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Fill gaps and drop invalid values (from storage, embedded HTML or the form). `base` is the layer a
 * blank/invalid field inherits from — DEFAULT_SETTINGS normally, or the resolved global layer when
 * resolving one plant (per-plant override → global → default).
 */
export function withDefaults(raw: Partial<PlantSettings> = {}, base: PlantSettings = DEFAULT_SETTINGS): PlantSettings {
  const s: PlantSettings = { ...base }
  for (const k of NUMERIC) {
    const v = raw[k]
    if (positive(v)) s[k] = v
  }
  for (const k of OPTIONAL) {
    const v = raw[k]
    if (positive(v)) s[k] = v
  }
  if (typeof raw.name === 'string' && raw.name.trim()) s.name = raw.name.trim()
  if (typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)) s.startDate = raw.startDate
  return s
}

function browserStorage(): KV | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // blocked storage (private mode, file:// policies)
  }
}

export function loadSettings(kv: KV | null = browserStorage()): SettingsMap {
  try {
    const v: unknown = JSON.parse(kv?.getItem(STORAGE_KEY) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as SettingsMap) : {}
  } catch {
    return {}
  }
}

export function saveSettings(map: SettingsMap, kv: KV | null = browserStorage()): boolean {
  try {
    kv?.setItem(STORAGE_KEY, JSON.stringify(map))
    return kv !== null
  } catch {
    return false
  }
}

/** Forget the stored settings for this scope (used by the "ล้างข้อมูล" button). */
export function clearSettings(kv: KV | null = browserStorage()): void {
  try {
    kv?.removeItem?.(STORAGE_KEY)
  } catch {
    // ignore: nothing to forget if storage is blocked
  }
}

/** The system-wide defaults layer (the "ตั้งค่ารวม" tab). Blank global fields fall back to DEFAULT_SETTINGS. */
export const globalSettings = (map: SettingsMap): PlantSettings => withDefaults(map[GLOBAL_KEY])

/** Resolve one plant through all three layers: per-plant override → global → built-in default/auto. */
export const settingsFor = (map: SettingsMap, plantId: string): PlantSettings =>
  withDefaults(map[plantId], globalSettings(map))

/**
 * Electricity price for a calendar month (1–12). The first half of the year uses `tariff`; the second
 * half uses `tariffH2` when a half-year split is set, otherwise `tariff` (single price all year).
 */
export const tariffForMonth = (s: PlantSettings, month: number): number =>
  month <= 6 ? s.tariff : (s.tariffH2 ?? s.tariff)

/** Average yearly price: the mean of the two halves when split, otherwise the single `tariff`. */
export const avgTariff = (s: PlantSettings): number =>
  s.tariffH2 != null ? (s.tariff + s.tariffH2) / 2 : s.tariff

/**
 * Fields a plant should have real values for before its numbers are trustworthy — the ones with no
 * meaningful universal default: installed size, peak sun hours and the electricity price.
 */
export const REQUIRED_FIELDS = ['kWp', 'sunHours', 'tariff'] as const
export type RequiredField = (typeof REQUIRED_FIELDS)[number]

/**
 * Which required fields are still unfilled for a plant — i.e. no real value at the per-plant OR the
 * global layer, so the built-in fallback default is all that applies. Reads the RAW map (not the
 * resolved settings, which can no longer tell a real value from a default). Empty array = complete.
 */
export function missingSettings(map: SettingsMap, plantId: string): RequiredField[] {
  const plant = map[plantId] ?? {}
  const global = map[GLOBAL_KEY] ?? {}
  const filled = (f: RequiredField): boolean => positive(plant[f]) || positive(global[f])
  return REQUIRED_FIELDS.filter((f) => !filled(f))
}

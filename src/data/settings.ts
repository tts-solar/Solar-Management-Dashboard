/** Per-plant assumptions. Real values are unknown yet, so every field is editable in the app. */
export interface PlantSettings {
  name: string | null // display name; null → plant id
  kWp: number | null // null → estimated from peak output
  sunHours: number // peak sun hours per day
  performanceRatio: number // 0..1
  peakTestKwhPerDay: number | null // null → simulate × peakTestFactor
  peakTestFactor: number
  abnormalBelow: number // efficiency fraction under which a period is flagged
  tariff: number // THB per kWh saved
  startDate: string | null // commissioning date YYYY-MM-DD; null → first day of real data (auto)
  investment: number | null // THB; null → sized so the plan pays back in paybackPlanYears
  paybackPlanYears: number
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
  startDate: null,
  investment: null,
  paybackPlanYears: 7,
}

/** kWp estimate = highest interval-average kW ÷ this ratio. */
export const PEAK_TO_KWP = 0.8

export type SettingsMap = Record<string, Partial<PlantSettings>>
type KV = Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: Storage['removeItem'] }

const STORAGE_KEY = 'solar-dashboard:settings:v1'
const NUMERIC = ['sunHours', 'performanceRatio', 'peakTestFactor', 'abnormalBelow', 'tariff', 'paybackPlanYears'] as const
const OPTIONAL = ['kWp', 'peakTestKwhPerDay', 'investment'] as const

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Fill gaps and drop invalid values (from storage, embedded HTML or the form). */
export function withDefaults(raw: Partial<PlantSettings> = {}): PlantSettings {
  const s: PlantSettings = { ...DEFAULT_SETTINGS }
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

export const settingsFor = (map: SettingsMap, plantId: string): PlantSettings => withDefaults(map[plantId])

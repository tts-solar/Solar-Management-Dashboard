/**
 * Synthetic demo plants B–E, bundled so the app shows a multi-plant portfolio out of the box
 * (like the Canva pitch) without the user dropping files or entering settings. MH stays the
 * original single-plant sample; these four add the other efficiency×age buckets.
 * Bundled only in the demo build (`--mode demo`); the offline build drops them (see IS_DEMO in main.ts).
 */
import bCsv from '../../data/sample-B.csv?raw'
import cCsv from '../../data/sample-C.csv?raw'
import dCsv from '../../data/sample-D.csv?raw'
import eCsv from '../../data/sample-E.csv?raw'
import { parseCsv } from './csv'
import type { SettingsMap } from './settings'
import type { Plant } from './types'

const RAW: Record<string, string> = { B: bCsv, C: cCsv, D: dCsv, E: eCsv }

/** Parse the bundled B–E CSVs into plants (same shape as the MH sample). */
export function demoPlants(): Plant[] {
  return Object.entries(RAW).map(([id, csv]) => {
    const parsed = parseCsv(csv)
    return { id, name: id, daily: parsed.daily, source: `sample-${id}.csv`, profile: parsed.profile }
  })
}

/**
 * Preset per-plant settings so the efficiency-vs-age scatter lands in the Canva buckets without
 * manual entry. kWp is set explicitly (so efficiency is deterministic, not peak-derived) and
 * startDate drives age: D is past the ~12.5y re-invest line, E is young → "abnormal".
 */
export const DEMO_SETTINGS: SettingsMap = {
  B: { name: 'Plant B', kWp: 60, startDate: '2023-06-01' }, // high-eff, young → standard
  C: { name: 'Plant C', kWp: 100, startDate: '2018-05-01' }, // good-eff, mid → normal
  D: { name: 'Plant D', kWp: 25, startDate: '2012-03-01' }, // low-eff, old → re-invest
  E: { name: 'Plant E', kWp: 45, startDate: '2022-09-01' }, // low-eff, young → abnormal
}

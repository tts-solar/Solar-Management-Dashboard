/**
 * Solar vs Storage advisor. Answers one question per plant — add more Solar, add Power Storage,
 * or leave it as is — from the daily energy balance (produced / consumed / exported / imported).
 *
 * Storage sizing also reads the average-day PROFILE when the plant carries one (built from the raw
 * 15-min intervals in csv.ts): a battery only time-shifts surplus that arrives BEFORE the demand it
 * covers, so the profile is replayed as a charge/discharge cycle to find how much of each day's
 * surplus is genuinely shiftable, and the peak flow that sets the battery's power. Without a profile
 * (plants imported before profiles existed) it falls back to the daily-total estimate.
 */
import type { DailyRow, DayProfile } from './types'
import { avgTariff } from './settings'
import type { Resolved } from './metrics'

/** Battery depth-of-discharge and round-trip efficiency used for first-order sizing. */
export const DOD = 0.9
export const ROUND_TRIP = 0.9
/** A flow smaller than this share of daily consumption is treated as negligible. */
const MEANINGFUL = 0.05

/** Typical installed add-on prices (THB), editable in the what-if controls. */
export const DEFAULT_SOLAR_COST = 25000 // ฿ per kW
export const DEFAULT_STORAGE_COST = 15000 // ฿ per kWh

export type Verdict = 'solar' | 'storage' | 'enough'

export interface Advice {
  days: number
  /** per typical day, kWh */
  avgProduced: number
  avgConsumed: number
  avgExported: number // surplus sent to the grid
  avgImported: number // energy bought from the grid
  avgSelfUsed: number // produced and used on site
  /** (produced − exported) / produced — share of own generation used on site */
  selfConsumption: number | null
  /** (consumed − imported) / consumed — share of demand met by own solar */
  selfSufficiency: number | null
  coverRate: number | null
  verdict: Verdict
  /** recommended add-on size — kW for solar, kWh for storage; 0 when verdict = enough */
  size: number
  /** energy per typical day a battery can actually time-shift (kWh); null when sized without a profile */
  shiftableKwh: number | null
  /** battery power the profile's peak flow implies (kW); null when sized without a profile */
  powerKw: number | null
  /** true when storage sizing used the 15-min profile rather than the daily-total fallback */
  sizedFromProfile: boolean
  reason: string
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round = (n: number): number => Math.round(n)

/**
 * Replay the average day as a battery cycle: charge on every surplus slot, discharge to cover the
 * import in each later slot. `shiftable` is the energy actually moved (bounded by timing), and
 * `peakFlow` the largest single-slot flow (sets the power rating). Totals let callers rescale to the
 * on-screen period's magnitude.
 */
function simulateProfile(profile: DayProfile): {
  shiftable: number
  totExport: number
  totImport: number
  peakFlow: number
  intervalMin: number
} {
  let soc = 0
  let shiftable = 0
  let totExport = 0
  let totImport = 0
  let peakFlow = 0
  for (const s of profile) {
    soc += s.exported
    const give = Math.min(soc, s.imported)
    soc -= give
    shiftable += give
    totExport += s.exported
    totImport += s.imported
    peakFlow = Math.max(peakFlow, s.exported, s.imported)
  }
  const intervalMin = profile.length >= 2 ? profile[1].minute - profile[0].minute : 15
  return { shiftable, totExport, totImport, peakFlow, intervalMin }
}

export function advise(daily: DailyRow[], r: Resolved, profile?: DayProfile): Advice {
  const avgProduced = mean(daily.map((d) => d.produced))
  const avgConsumed = mean(daily.map((d) => d.consumed))
  const avgExported = mean(daily.map((d) => d.exported))
  const avgImported = mean(daily.map((d) => d.imported))
  const avgSelfUsed = Math.max(0, avgProduced - avgExported)
  const selfConsumption = avgProduced > 0 ? avgSelfUsed / avgProduced : null
  const selfSufficiency = avgConsumed > 0 ? Math.max(0, avgConsumed - avgImported) / avgConsumed : null
  const coverRate = avgConsumed > 0 ? avgProduced / avgConsumed : null

  const impFrac = avgConsumed > 0 ? avgImported / avgConsumed : 0
  const expFrac = avgProduced > 0 ? avgExported / avgProduced : 0
  const perKw = r.sunHours * r.performanceRatio // extra kWh/day per kW of solar added

  // profile-aware storage sizing: how much surplus is time-shiftable + the power the peak flow needs,
  // rescaled from the representative day to the magnitude of the period on screen
  let shiftableKwh: number | null = null
  let powerKw: number | null = null
  let sizedFromProfile = false
  if (profile && profile.length) {
    const sim = simulateProfile(profile)
    shiftableKwh =
      sim.totImport > 0 ? Math.min(avgExported, avgImported, sim.shiftable * (avgImported / sim.totImport)) : 0
    const scale = sim.totExport > 0 ? avgExported / sim.totExport : 1
    powerKw = (sim.peakFlow * scale * 60) / sim.intervalMin
    sizedFromProfile = true
  }

  let verdict: Verdict
  let size = 0
  let reason: string
  if (impFrac < MEANINGFUL && expFrac < MEANINGFUL) {
    verdict = 'enough'
    reason = 'ผลิตกับใช้สมดุลกันดีแล้ว ซื้อ/ขายไฟน้อยมาก — ลงทุนเพิ่มยังไม่คุ้ม'
  } else if (impFrac >= MEANINGFUL && expFrac >= MEANINGFUL) {
    // surplus by day AND buying by night → time-shift it. Size = the genuinely shiftable energy /
    // usable depth (profile-timed when available, else the smaller daily flow).
    verdict = 'storage'
    const shiftable = shiftableKwh ?? Math.min(avgExported, avgImported)
    size = round(shiftable / DOD)
    reason = `ไฟเหลือขายออก ~${round(avgExported)} kWh/วัน แต่ยังซื้อไฟ ~${round(avgImported)} kWh/วัน — เก็บไฟเหลือไว้ใช้เองคุ้มกว่า`
  } else if (impFrac >= MEANINGFUL) {
    // buying power with little or no surplus → the plant simply makes too little. Add panels.
    verdict = 'solar'
    size = perKw > 0 ? round(avgImported / perKw) : 0
    reason = `ผลิตไม่พอ ยังซื้อไฟ ~${round(avgImported)} kWh/วัน และแทบไม่มีไฟเหลือให้เก็บ — เพิ่มแผงช่วยได้`
  } else {
    // big surplus but barely any import → already covers its own load; more kit won't pay back.
    verdict = 'enough'
    reason = `ผลิตเกินใช้ ไฟเหลือ ~${round(avgExported)} kWh/วัน แต่ซื้อไฟน้อย — ควรขายไฟส่วนเกิน ลงทุนเพิ่มยังไม่คุ้ม`
  }
  return {
    days: daily.length,
    avgProduced,
    avgConsumed,
    avgExported,
    avgImported,
    avgSelfUsed,
    selfConsumption,
    selfSufficiency,
    coverRate,
    verdict,
    size,
    shiftableKwh,
    powerKw,
    sizedFromProfile,
    reason,
  }
}

export interface WhatIfParams {
  addSolarKw: number
  addStorageKwh: number
  solarCostPerKw: number
  storageCostPerKwh: number
  /** scenario production per typical day (kWh); defaults to the measured average */
  baseProduced?: number
  /** scenario consumption per typical day (kWh); defaults to the measured average */
  baseConsumed?: number
}

export interface WhatIfResult {
  newImport: number // projected grid import per day, kWh
  newExport: number
  importAvoided: number // daily import removed vs now, kWh
  newSelfConsumption: number | null
  newSelfSufficiency: number | null
  annualSaving: number // THB/year (reduced grid import × tariff)
  addOnCost: number // THB
  paybackYears: number | null // null = never / no cost
}

/**
 * Project a typical day after adding solar and/or storage. Solar is applied first (it displaces
 * daytime import it can reach, bounded by what is still bought, and spills the rest to export), then
 * storage charges from the resulting surplus and discharges to displace the remaining import (minus a
 * round-trip loss) — so pairing solar with storage shows its synergy. Savings are valued only on
 * avoided grid import at the plant tariff; new export is credited at nothing (FiT varies), keeping
 * payback honest rather than flattering.
 */
export function whatIf(a: Advice, r: Resolved, p: WhatIfParams): WhatIfResult {
  const tariff = avgTariff(r)
  const perKw = r.sunHours * r.performanceRatio
  let imp = a.avgImported
  let exp = a.avgExported

  // Scenario baseline: production/consumption default to the measured averages but can be overridden
  // in the what-if controls. Shift the measured import/export by each delta (timing-naive first order):
  // extra production displaces import then spills to export; extra consumption eats surplus then
  // imports; the opposite directions mirror that. At the default values the deltas are 0, so the
  // measured balance — and every existing result — is untouched.
  const baseProduced = Math.max(0, p.baseProduced ?? a.avgProduced)
  const baseConsumed = Math.max(0, p.baseConsumed ?? a.avgConsumed)
  const dProduced = baseProduced - a.avgProduced
  if (dProduced >= 0) {
    const self = Math.min(dProduced, imp)
    imp -= self
    exp += dProduced - self
  } else {
    const lost = -dProduced
    const fromExp = Math.min(lost, exp)
    exp -= fromExp
    imp += lost - fromExp
  }
  const dConsumed = baseConsumed - a.avgConsumed
  if (dConsumed >= 0) {
    const fromExp = Math.min(dConsumed, exp)
    exp -= fromExp
    imp += dConsumed - fromExp
  } else {
    const freed = -dConsumed
    const cutImp = Math.min(freed, imp)
    imp -= cutImp
    exp += freed - cutImp
  }
  const baseImport = imp // scenario import before the add-ons — savings are measured against this

  const extraGen = Math.max(0, p.addSolarKw) * perKw
  const solarSelf = Math.min(extraGen, imp)
  imp -= solarSelf
  exp += extraGen - solarSelf

  // battery can only shift surplus that lines up in time with demand; the profile-derived cap keeps
  // the what-if honest (no cap when the plant has no profile → same as before)
  const timingCap = a.shiftableKwh ?? Infinity
  const usable = Math.max(0, p.addStorageKwh) * DOD
  const charge = Math.min(usable, exp)
  const delivered = Math.min(charge * ROUND_TRIP, imp, timingCap)
  imp -= delivered
  exp -= charge

  // savings/payback reflect only the add-on investment: import removed vs the chosen scenario baseline
  const importAvoided = Math.max(0, baseImport - imp)
  const annualSaving = importAvoided * tariff * 365
  const addOnCost = Math.max(0, p.addSolarKw) * p.solarCostPerKw + Math.max(0, p.addStorageKwh) * p.storageCostPerKwh
  const newProduced = baseProduced + extraGen
  const newSelfConsumption = newProduced > 0 ? Math.max(0, newProduced - exp) / newProduced : null
  const newSelfSufficiency = baseConsumed > 0 ? Math.max(0, baseConsumed - imp) / baseConsumed : null
  const paybackYears = annualSaving > 0 && addOnCost > 0 ? addOnCost / annualSaving : null
  return {
    newImport: imp,
    newExport: exp,
    importAvoided,
    newSelfConsumption,
    newSelfSufficiency,
    annualSaving,
    addOnCost,
    paybackYears,
  }
}

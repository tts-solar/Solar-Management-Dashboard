/**
 * Solar vs Storage advisor. Answers one question per plant — add more Solar, add Power Storage,
 * or leave it as is — from the DAILY energy balance the app keeps (produced / consumed / exported /
 * imported per day). The 15-min profile is folded away at parse time (csv.ts), so this is a
 * first-order read on energy totals, NOT a verified hour-by-hour day/night profile: storage sizing
 * is a sensible estimate, not a design figure. See advisorNote() for the caveat shown in the UI.
 */
import type { DailyRow } from './types'
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
  reason: string
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const round = (n: number): number => Math.round(n)

export function advise(daily: DailyRow[], r: Resolved): Advice {
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

  let verdict: Verdict
  let size = 0
  let reason: string
  if (impFrac < MEANINGFUL && expFrac < MEANINGFUL) {
    verdict = 'enough'
    reason = 'ผลิตกับใช้สมดุลกันดีแล้ว ซื้อ/ขายไฟน้อยมาก — ลงทุนเพิ่มยังไม่คุ้ม'
  } else if (impFrac >= MEANINGFUL && expFrac >= MEANINGFUL) {
    // surplus by day AND buying by night → time-shift it. Size = the smaller flow / usable depth.
    verdict = 'storage'
    size = round(Math.min(avgExported, avgImported) / DOD)
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
    reason,
  }
}

export interface WhatIfParams {
  addSolarKw: number
  addStorageKwh: number
  solarCostPerKw: number
  storageCostPerKwh: number
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

  const extraGen = Math.max(0, p.addSolarKw) * perKw
  const solarSelf = Math.min(extraGen, imp)
  imp -= solarSelf
  exp += extraGen - solarSelf

  const usable = Math.max(0, p.addStorageKwh) * DOD
  const charge = Math.min(usable, exp)
  const delivered = Math.min(charge * ROUND_TRIP, imp)
  imp -= delivered
  exp -= charge

  const importAvoided = Math.max(0, a.avgImported - imp)
  const annualSaving = importAvoided * tariff * 365
  const addOnCost = Math.max(0, p.addSolarKw) * p.solarCostPerKw + Math.max(0, p.addStorageKwh) * p.storageCostPerKwh
  const newProduced = a.avgProduced + extraGen
  const newSelfConsumption = newProduced > 0 ? Math.max(0, newProduced - exp) / newProduced : null
  const newSelfSufficiency = a.avgConsumed > 0 ? Math.max(0, a.avgConsumed - imp) / a.avgConsumed : null
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

/**
 * Solar vs Storage advisor. Answers one question per plant — add more Solar, add Power Storage,
 * or leave it as is — from the daily energy balance (produced / consumed / exported / imported).
 *
 * EVERY figure in here is per CALENDAR DAY, and deliberately so: the solar yield of an added kW is
 * kWh/day (sun hours × performance ratio), a battery is assumed to cycle once a day, and savings
 * annualise by × 365. The input rows are NOT always days, though — a monthly Plant Report folds a
 * whole month into one row — so the averages divide by `spanDays(daily)`, the days the rows cover,
 * never by the row count. That single conversion at the entry is what lets one set of formulas serve
 * a 15-min CSV import and a monthly report alike; anything added below may assume "per day" freely.
 *
 * Storage sizing also reads the average-day PROFILE when the plant carries one (built from the raw
 * 15-min intervals in csv.ts): a battery only time-shifts surplus that arrives BEFORE the demand it
 * covers, so the profile is replayed as a charge/discharge cycle to find how much of each day's
 * surplus is genuinely shiftable, and the peak flow that sets the battery's power. Without a profile
 * (plants imported before profiles existed) it falls back to the daily-total estimate.
 */
import type { DailyRow, DayProfile } from './types'
import { DAYS_PER_YEAR, hasDailyDetail, spanDays } from './aggregate'
import { fmt0 } from '../format'
import { avgTariffForYear } from './settings'
import type { Resolved } from './metrics'

/** Battery depth-of-discharge and round-trip efficiency used for first-order sizing. */
export const DOD = 0.9
export const ROUND_TRIP = 0.9
/** A flow smaller than this share of daily consumption is treated as negligible. */
const MEANINGFUL = 0.05

/**
 * Typical installed add-on prices (THB) the what-if controls start from. Module constants on purpose:
 * they are scratch values for one scenario, not facts about a plant, so they are not part of
 * PlantSettings and get no row in the settings dialog. Typing over them in the what-if lasts as long
 * as that dialog is open.
 */
export const DEFAULT_SOLAR_COST = 25000 // ฿ per kW
export const DEFAULT_STORAGE_COST = 15000 // ฿ per kWh

export type Verdict = 'solar' | 'storage' | 'enough' | 'nodata'

export interface Advice {
  /** calendar days the rows cover — the basis every average below is divided by */
  days: number
  /** data rows behind those days: the same as `days` for a daily import, months for a monthly report */
  rows: number
  /** source is a monthly report, so a "typical day" is a whole month's average, not a measured day */
  monthly: boolean
  /** calendar year the rows end in — the year whose tariff prices the projected saving */
  year: number
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

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
const round = (n: number): number => Math.round(n)

/**
 * Extra kWh PER DAY that one added kW of solar is expected to yield. The single definition of the
 * plant's yield constant — sizing, the what-if projection and the view's production readout all read
 * it from here, so they can never drift apart.
 */
export const solarPerKwPerDay = (r: Resolved): number => r.sunHours * r.performanceRatio

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
  peakExport: number
  peakImport: number
  intervalMin: number
} {
  let soc = 0
  let shiftable = 0
  let totExport = 0
  let totImport = 0
  // the two peaks are kept APART: the biggest export slot sets how fast the battery must charge, the
  // biggest import slot how fast it must discharge, and each is rescaled on its own basis by the
  // caller. One combined peak would end up rescaled by whichever ratio happened to be used.
  let peakExport = 0
  let peakImport = 0
  // smallest positive step between slots = the logging interval. Taking profile[1] − profile[0] would
  // read a skipped slot at the start of the day as the interval; every real gap is a multiple of it.
  let intervalMin = Infinity
  for (let i = 0; i < profile.length; i++) {
    const s = profile[i]
    soc += s.exported
    const give = Math.min(soc, s.imported)
    soc -= give
    shiftable += give
    totExport += s.exported
    totImport += s.imported
    peakExport = Math.max(peakExport, s.exported)
    peakImport = Math.max(peakImport, s.imported)
    if (i > 0) {
      const step = s.minute - profile[i - 1].minute
      if (step > 0) intervalMin = Math.min(intervalMin, step)
    }
  }
  return { shiftable, totExport, totImport, peakExport, peakImport, intervalMin: Number.isFinite(intervalMin) ? intervalMin : 15 }
}

export function advise(daily: DailyRow[], r: Resolved, profile?: DayProfile): Advice {
  // per CALENDAR DAY, not per row — a monthly report's row holds a whole month (see spanDays)
  const days = spanDays(daily)
  const perDay = (of: (d: DailyRow) => number): number => (days > 0 ? sum(daily.map(of)) / days : 0)
  const avgProduced = perDay((d) => d.produced)
  const avgConsumed = perDay((d) => d.consumed)
  const avgExported = perDay((d) => d.exported)
  const avgImported = perDay((d) => d.imported)
  const avgSelfUsed = Math.max(0, avgProduced - avgExported)
  const selfConsumption = avgProduced > 0 ? avgSelfUsed / avgProduced : null
  const selfSufficiency = avgConsumed > 0 ? Math.max(0, avgConsumed - avgImported) / avgConsumed : null

  const impFrac = avgConsumed > 0 ? avgImported / avgConsumed : 0
  const expFrac = avgProduced > 0 ? avgExported / avgProduced : 0
  const perKw = solarPerKwPerDay(r) // extra kWh/day per kW of solar added

  // profile-aware storage sizing: how much surplus is time-shiftable + the power the peak flow needs,
  // rescaled from the representative day to the magnitude of the period on screen
  let shiftableKwh: number | null = null
  let powerKw: number | null = null
  let sizedFromProfile = false
  if (profile && profile.length) {
    const sim = simulateProfile(profile)
    shiftableKwh =
      sim.totImport > 0 ? Math.min(avgExported, avgImported, sim.shiftable * (avgImported / sim.totImport)) : 0
    const expScale = sim.totExport > 0 ? avgExported / sim.totExport : 1
    const impScale = sim.totImport > 0 ? avgImported / sim.totImport : 1
    const peakKwh = Math.max(sim.peakExport * expScale, sim.peakImport * impScale)
    powerKw = (peakKwh * 60) / sim.intervalMin
    sizedFromProfile = true
  }

  let verdict: Verdict
  let size = 0
  let reason: string
  if (!days) {
    // zero rows makes every average 0, which the balance test below would read as a perfectly
    // balanced plant and answer "เพียงพอแล้ว" — a confident recommendation from no evidence at all.
    verdict = 'nodata'
    reason = 'ยังไม่มีข้อมูลในช่วงเวลาที่เลือก — เลือกช่วงที่มีข้อมูลก่อน จึงจะประเมินได้'
  } else if (impFrac < MEANINGFUL && expFrac < MEANINGFUL) {
    verdict = 'enough'
    reason = 'ผลิตกับใช้สมดุลกันดีแล้ว ซื้อ/ขายไฟน้อยมาก — ลงทุนเพิ่มยังไม่คุ้ม'
  } else if (impFrac >= MEANINGFUL && expFrac >= MEANINGFUL) {
    // surplus by day AND buying by night → time-shift it. Size = the genuinely shiftable energy /
    // usable depth (profile-timed when available, else the smaller daily flow).
    verdict = 'storage'
    const shiftable = shiftableKwh ?? Math.min(avgExported, avgImported)
    size = round(shiftable / DOD)
    reason = `ไฟเหลือขายออก ~${fmt0(round(avgExported))} kWh/วัน แต่ยังซื้อไฟ ~${fmt0(round(avgImported))} kWh/วัน — เก็บไฟเหลือไว้ใช้เองคุ้มกว่า`
  } else if (impFrac >= MEANINGFUL) {
    // buying power with little or no surplus → the plant simply makes too little. Add panels.
    verdict = 'solar'
    size = perKw > 0 ? round(avgImported / perKw) : 0
    reason = `ผลิตไม่พอ ยังซื้อไฟ ~${fmt0(round(avgImported))} kWh/วัน และแทบไม่มีไฟเหลือให้เก็บ — เพิ่มแผงช่วยได้`
  } else {
    // big surplus but barely any import → already covers its own load; more kit won't pay back.
    verdict = 'enough'
    reason = `ผลิตเกินใช้ ไฟเหลือ ~${fmt0(round(avgExported))} kWh/วัน แต่ซื้อไฟน้อย — ควรขายไฟส่วนเกิน ลงทุนเพิ่มยังไม่คุ้ม`
  }
  return {
    days,
    rows: daily.length,
    monthly: daily.length > 0 && !hasDailyDetail(daily),
    year: +(daily[daily.length - 1]?.date ?? r.startDate).slice(0, 4),
    avgProduced,
    avgConsumed,
    avgExported,
    avgImported,
    avgSelfUsed,
    selfConsumption,
    selfSufficiency,
    verdict,
    size,
    shiftableKwh,
    powerKw,
    sizedFromProfile,
    reason,
  }
}

/**
 * The verdict line shown above the reason. Lives here, beside the `reason` strings it heads, so the
 * two always agree.
 *
 * A monthly report gets no kWh figure for STORAGE. Sizing a battery is a question about TIMING — how
 * much surplus arrives before the demand it would cover — and a month's totals answer nothing about
 * timing: the same month could export at noon and import at 8pm (a battery helps a lot) or export in
 * March and import in December (it helps not at all). The rough number still prefills the what-if as
 * a starting point to play with, but it is not stated as a recommendation.
 *
 * SOLAR is different and keeps its figure: "how many kW to cover this much yearly import" is a
 * question about ENERGY, which monthly totals answer perfectly well.
 */
export function headline(a: Advice): string {
  if (a.verdict === 'nodata') return 'ยังไม่มีข้อมูลพอจะแนะนำ'
  if (a.verdict === 'enough') return 'เพียงพอแล้ว'
  if (a.verdict === 'solar') return `แนะนำ: เพิ่ม Solar ~${fmt0(a.size)} kW`
  return a.monthly
    ? 'แนะนำ: พิจารณา Energy Storage — ข้อมูลรายเดือนยังระบุขนาดไม่ได้'
    : `แนะนำ: เพิ่ม Energy Storage ~${fmt0(a.size)} kWh`
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
 *
 * Energy is conserved across the battery: it is sized from what it will actually DELIVER, so surplus
 * it could hold but never discharge (no import left to displace, or the timing cap) is simply still
 * exported. Charging it away would make self-consumption read higher for no saving at all.
 */
export function whatIf(a: Advice, r: Resolved, p: WhatIfParams): WhatIfResult {
  // priced at the tariff of the year the data ends in, so a plant with per-year prices set in its
  // settings projects at the latest one it knows rather than at the base rate (bep already does this)
  const tariff = avgTariffForYear(r, a.year, +r.startDate.slice(0, 4))
  const perKw = solarPerKwPerDay(r)
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
  const charge = Math.min(usable, exp) // the most this battery could take off the surplus
  const delivered = Math.min(charge * ROUND_TRIP, imp, timingCap) // what it can really give back
  const drawn = delivered / ROUND_TRIP // ...so only this much ever leaves the surplus
  imp -= delivered
  exp -= drawn

  // savings/payback reflect only the add-on investment: import removed vs the chosen scenario baseline
  const importAvoided = Math.max(0, baseImport - imp)
  const annualSaving = importAvoided * tariff * DAYS_PER_YEAR
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

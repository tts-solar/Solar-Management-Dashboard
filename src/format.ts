/**
 * Number and energy formatting, shared by every layer.
 *
 * It lives apart from charts/common.ts (which re-exports all of it, so existing imports are
 * unchanged) for one reason: common.ts imports Chart.js, and the data modules must not. The advisor
 * builds its own Thai verdict/reason strings and needs the same thousands separators the KPI cards
 * use — pulling a chart library into src/data to get them would be absurd, and letting it keep a
 * second copy of the formatter is how the two drift apart.
 */

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const N0 = nf(0)
const N1 = nf(1)

export const fmt0 = (n: number): string => N0.format(n)
export const fmt1 = (n: number): string => N1.format(n)
export const pct = (fraction: number | null, digits = 1): string =>
  fraction === null ? '–' : `${nf(digits).format(fraction * 100)}%`

/**
 * Single source of truth for the energy display unit. The whole app shows kWh everywhere — KPI cards,
 * chart axes and tooltips, treemap, tables and the PDF — so the unit never changes between views or
 * between points on one chart (large totals just read as big kWh numbers, e.g. 450,600 kWh). This is
 * a single table so it stays consistent: to bring back automatic kWh→MWh→GWh stepping, add the rows
 * `{ at: 1e6, unit: 'GWh', div: 1e6 }` and `{ at: 1e5, unit: 'MWh', div: 1e3 }` above the kWh row.
 * Ordered high→low; first threshold met wins.
 */
const ENERGY_UNITS: { at: number; unit: string; div: number }[] = [{ at: 0, unit: 'kWh', div: 1 }]
const energyUnit = (magnitude: number): { unit: string; div: number } =>
  ENERGY_UNITS.find((u) => Math.abs(magnitude) >= u.at)!

/** Energy as a kWh figure with thousands separators: 85,792 kWh · 450,600 kWh. */
export function energy(kwh: number): string {
  const { unit, div } = energyUnit(kwh)
  return `${div === 1 ? fmt0(kwh) : fmt1(kwh / div)} ${unit}`
}

/** The display unit/divisor for a whole series, so every point scales the same way (kWh today). */
export function energyScale(maxKwh: number): { unit: string; div: number } {
  return energyUnit(maxKwh)
}

/**
 * Format a kWh value in a GIVEN scale's unit instead of re-picking one per magnitude. A line chart's
 * axis is fixed by {@link energyScale}, so its tooltips must use the same scale — otherwise, if unit
 * stepping were on, a point below the next step (e.g. 90,000 kWh under a MWh axis) would read
 * "90,000 kWh" while the axis and its neighbours read MWh. Use this for every tooltip on a scaled
 * axis; use {@link energy} only where a value stands alone (a KPI card, a treemap tile).
 */
export function energyIn(kwh: number, scale: { unit: string; div: number }): string {
  return `${scale.div === 1 ? fmt0(kwh) : fmt1(kwh / scale.div)} ${scale.unit}`
}

export const baht = (n: number): string => `${fmt0(n)} ฿`

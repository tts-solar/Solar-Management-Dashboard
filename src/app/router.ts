/**
 * Hash routes — work from file:// too, so the downloaded offline copy navigates the same way.
 *   #/                                        → overview (all plants, latest year)
 *   #/overview/2026                           → overview of one year
 *   #/overview/r/2026-01-01/2026-03-31        → overview of a custom date range
 *   #/plant/MH/2026                           → one plant, one year
 *   #/plant/MH/2026/05                        → one plant, one month
 *   #/plant/MH/2026/r/2026-01-01/2026-03-31   → one plant, a custom date range
 *
 * `start`/`end` (both present = range mode) carry a YYYY-MM-DD span; plant keeps `year` even in range
 * mode so switching the filter back to the year/month picker has an anchor to return to.
 */
export type Route =
  | { view: 'overview'; year?: string; start?: string; end?: string }
  | { view: 'plant'; plant: string; year: string; month?: string; start?: string; end?: string }

const YEAR = /^\d{4}$/
const MONTH = /^(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode)
  if (parts[0] === 'plant' && parts[1] && YEAR.test(parts[2] ?? '')) {
    const route: Route = { view: 'plant', plant: parts[1], year: parts[2] }
    if (parts[3] === 'r' && DATE.test(parts[4] ?? '') && DATE.test(parts[5] ?? '')) {
      route.start = parts[4]
      route.end = parts[5]
    } else if (MONTH.test(parts[3] ?? '')) {
      route.month = parts[3]
    }
    return route
  }
  if (parts[0] === 'overview' && parts[1] === 'r' && DATE.test(parts[2] ?? '') && DATE.test(parts[3] ?? '')) {
    return { view: 'overview', start: parts[2], end: parts[3] }
  }
  if (parts[0] === 'overview' && YEAR.test(parts[1] ?? '')) return { view: 'overview', year: parts[1] }
  return { view: 'overview' }
}

export function toHash(route: Route): string {
  if (route.view === 'overview') {
    if (route.start && route.end) return `#/overview/r/${route.start}/${route.end}`
    return route.year ? `#/overview/${route.year}` : '#/'
  }
  const base = `#/plant/${encodeURIComponent(route.plant)}/${route.year}`
  if (route.start && route.end) return `${base}/r/${route.start}/${route.end}`
  return route.month ? `${base}/${route.month}` : base
}

export function go(route: Route): void {
  const hash = toHash(route)
  if (location.hash !== hash) location.hash = hash
}

/** Calls `cb` now and on every hash change; returns an unsubscribe function. */
export function onRoute(cb: (route: Route) => void): () => void {
  const fire = () => cb(parseHash(location.hash))
  window.addEventListener('hashchange', fire)
  fire()
  return () => window.removeEventListener('hashchange', fire)
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

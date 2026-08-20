import type { ArrayMeta } from '@/lib/store-schema'

// Unset falls back to the placeholder empty state. See .env.local.example.
export const STORE_URL = process.env.NEXT_PUBLIC_ICECHUNK_URL ?? ''

export const INTENDED_STORE_URL =
  'https://storage.googleapis.com/leap-public/data/CERES_EBAF/store.icechunk'

// zarr-layer fetches whole chunks, so a variable chunked as one big block would
// pull the entire array on first paint. Matches the LEAP catalog's guard.
export const MAX_CHUNK_MB = 8

const LAT = new Set(['lat', 'latitude', 'y'])
const LON = new Set(['lon', 'longitude', 'x'])
export const isSpatial = (d: string) => LAT.has(d) || LON.has(d)

/** Renderable = at least 2 dims, 2 of them spatial, and not itself a coordinate. */
export function renderable(v: ArrayMeta): boolean {
  if (v.dims.length < 2 || v.dims.filter(isSpatial).length < 2) return false
  const sn = String(v.attrs?.['standard_name'] ?? '')
  if (/^(latitude|longitude|projection_[xy]_coordinate)$/.test(sn)) return false
  if (v.attrs?.['crs_wkt']) return false
  return true
}

export function chunkMB(v: ArrayMeta): number {
  const m = v.dtype.match(/(\d+)/)
  const bytes = m ? Math.max(1, Number(m[1]) / 8) : 4
  return v.chunks ? (v.chunks.reduce((a, c) => a * c, 1) * bytes) / 1e6 : 0
}

export function units(v?: ArrayMeta): string {
  const u = String(v?.attrs?.['units'] ?? '')
  return u && u !== '1' ? u : ''
}

/**
 * Default color range. The pipeline writes robust 2nd/98th percentile bounds per
 * group as a `zarr-layer` hint; those read far better than CF `valid_range`,
 * which is a physical validity bound, so they win when present.
 */
export function defaultClim(v: ArrayMeta): [number, number] {
  if (v.hints?.clim) return v.hints.clim
  const a: Record<string, unknown> = v.attrs ?? {}
  const range = a['valid_range']
  if (Array.isArray(range) && range.length === 2) {
    return [Number(range[0]), Number(range[1])]
  }
  const lo = a['valid_min'] ?? a['vmin']
  const hi = a['valid_max'] ?? a['vmax']
  if (lo != null && hi != null) return [Number(lo), Number(hi)]
  const u = units(v)
  if (/percent|%/i.test(u)) return [0, 100]
  if (/^K$|kelvin/i.test(u)) return [200, 320]
  return [0, 1]
}

/**
 * Net and cloud-radiative-effect fluxes straddle zero, so they read correctly
 * only on a diverging map. Everything else gets a sequential one.
 */
export function isDiverging(v: ArrayMeta): boolean {
  const [lo, hi] = defaultClim(v)
  return lo < 0 && hi > 0
}

export function defaultColormap(v: ArrayMeta): string {
  if (v.hints?.colormap) return v.hints.colormap
  if (isDiverging(v)) {
    // Reversed: on a diverging ramp the warm end has to sit at the positive
    // end, or an energy gain reads cool and a loss reads warm.
    return /_cre_/.test(v.name) ? 'orangeblue_r' : 'redteal_r'
  }
  if (/^cldarea/.test(v.name)) return 'blues'
  if (/^cldtau/.test(v.name)) return 'greys'
  if (/^cldtemp/.test(v.name)) return 'warm'
  if (/^cldpress/.test(v.name)) return 'cool'
  if (/_lw_|^toa_lw|^solar/.test(v.name)) return 'fire'
  return 'warm'
}

/**
 * Human label for a DataTree group path. CERES writes raw monthly data under
 * `monthly` and derived climatologies under `climatology/<period>`.
 */
export function groupLabel(group: string): string {
  if (!group || group === 'monthly') return 'Monthly (raw)'
  // The whole-record mean is not a period, so it gets its own wording; it is
  // the equivalent of the Data Library's `[T] average`.
  if (group === 'climatology/mean') return 'Climatology · whole record'
  const m = group.match(/^climatology\/(.+)$/)
  if (m) {
    const period = m[1].replace(/[_/]/g, ' ')
    return `Climatology · ${period}`
  }
  return group.replace(/[_/]/g, ' ')
}

/**
 * Variables the EESC UN2100 labs actually use.
 *
 * The store carries ~48 variables per group, which is an unusable dropdown for
 * an intro class. Everything outside this list is still reachable via the
 * "all variables" toggle. Deliberately excluded: the 27 `sfc_*` fluxes, the
 * cloud-property variables, and every `clr_t` variant — the lab's ERBE
 * "clear-sky" means clear-sky-for-cloud-free-areas (`clr_c`), and offering
 * both invites the wrong pick on a graded task.
 */
export const LAB_VARS = [
  'toa_albedo_all_mon',
  'toa_albedo_clr_mon',
  'toa_sw_all_mon',
  'toa_sw_clr_c_mon',
  'toa_lw_all_mon',
  'toa_lw_clr_c_mon',
  'toa_net_all_mon',
  'solar_mon',
  'toa_cre_net_mon',
  'toa_cre_sw_mon',
  'toa_cre_lw_mon',
  'cldarea_total_daynight_mon',
  'toa_t_eff',
  'sfc_t_skin',
]

export const isLabVar = (v: ArrayMeta) => LAB_VARS.includes(v.name)

/**
 * Landing view, in preference order. `LAB_VARS` is an unordered allowlist, so
 * without this the first render is decided by whatever order the store happens
 * to list its arrays in. Net flux is the app's title subject.
 */
export const DEFAULT_VARS = [
  'toa_net_all_mon',
  'toa_albedo_all_mon',
  'toa_lw_all_mon',
]

/** Sidebar grouping. CERES variable names are prefixed by measurement location. */
export function groupOf(name: string): string {
  if (name.endsWith('_t_eff') || name.endsWith('_t_skin')) return 'Temperature'
  if (name.startsWith('toa_')) return 'Top of atmosphere'
  if (name.startsWith('sfc_')) return 'Surface'
  if (name.startsWith('cld')) return 'Cloud'
  if (name.startsWith('solar')) return 'Solar'
  return 'Other'
}

export const GROUP_ORDER = [
  'Top of atmosphere',
  'Temperature',
  'Surface',
  'Cloud',
  'Solar',
  'Other',
]

/**
 * Sky condition, read from the variable name rather than the long_name.
 *
 * `clr_c` is clear-sky over the cloud-free part of a region — what the lab
 * calls clear-sky; `clr_t` is the whole region with clouds removed by a
 * radiative transfer model, which is the modellers' convention.
 */
const SKY_CONDITIONS: Array<[RegExp, string]> = [
  [/_clr_c(_|$)/, 'clear-sky'],
  [/_clr_t(_|$)/, 'clear-sky (modeled)'],
  [/_clr(_|$)/, 'clear-sky'],
  [/_all(_|$)/, 'all-sky'],
]

export function skyCondition(name: string): string | null {
  for (const [pattern, label] of SKY_CONDITIONS) {
    if (pattern.test(name)) return label
  }
  return null
}

/**
 * The physical quantity a variable measures, read from its name.
 *
 * Units alone are too coarse to decide whether two variables can be subtracted:
 * albedo and cloud area fraction are both "percent", but their difference means
 * nothing. Order matters below — `toa_cre_sw_mon` has to match the CRE patterns
 * before the bare `_sw_` one, and the `cld*` families before `temperature`.
 */
export function quantityKind(name: string): string {
  if (/_cre_sw(_|$)/.test(name)) return 'cre-sw'
  if (/_cre_lw(_|$)/.test(name)) return 'cre-lw'
  if (/_cre_net(_|$)/.test(name)) return 'cre-net'
  if (/albedo/.test(name)) return 'albedo'
  if (/^cldarea/.test(name)) return 'cloud-fraction'
  if (/^cldtau/.test(name)) return 'cloud-optical-depth'
  if (/^cldpress/.test(name)) return 'cloud-pressure'
  if (/^cldtemp/.test(name)) return 'cloud-temperature'
  if (/_t_eff$|_t_skin$/.test(name)) return 'temperature'
  if (/^solar/.test(name)) return 'solar'
  if (/_net(_|$)/.test(name)) return 'net'
  if (/_sw(_|$)/.test(name)) return 'sw'
  if (/_lw(_|$)/.test(name)) return 'lw'
  return 'other'
}

/**
 * Kinds that are all radiative fluxes in W m-2, so cross-kind subtraction is
 * still physical — outgoing longwave minus reflected shortwave is a legitimate
 * energy-budget question, unlike albedo minus cloud fraction.
 */
export const RADIATIVE_FLUX_KINDS = new Set([
  'sw',
  'lw',
  'net',
  'solar',
  'cre-sw',
  'cre-lw',
  'cre-net',
])

/**
 * Display label: the physical quantity, then the sky condition.
 *
 * A CF long_name reads "<quantity>, <sky> conditions, <period>". The period is
 * already fixed by the Dataset picker, and the climatology groups are written
 * with the sky clause dropped altogether — which is what made, say,
 * `toa_sw_all_mon` and `toa_sw_clr_c_mon` share one entry in the dropdown. So
 * take the quantity from the long_name and the condition from the variable
 * name, which always carries it.
 */
export function labelOf(v: ArrayMeta): string {
  const long = String(v.attrs?.['long_name'] ?? '').trim()
  const base = (long.split(',')[0] || v.name)
    .trim()
    .replace(/^Top of (The )?Atmosphere/i, 'TOA')
    // Trailing parentheticals are derivation notes we wrote ourselves, e.g.
    // "(from TOA longwave)". The tooltip still carries them.
    .replace(/\s*\([^)]*\)\s*$/, '')
  const sky = skyCondition(v.name)
  return sky ? `${base} \u00b7 ${sky}` : base
}

/** The unabridged long_name, for a tooltip on the dropdown entry. */
export function describeOf(v: ArrayMeta): string {
  return String(v.attrs?.['long_name'] ?? '').trim() || v.name
}

export function formatValue(x: number): string {
  if (!isFinite(x)) return '—'
  const a = Math.abs(x)
  if (a !== 0 && (a >= 10000 || a < 0.01)) return x.toExponential(2)
  return Number.isInteger(x) ? String(x) : x.toFixed(2)
}

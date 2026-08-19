import type { QueryDataValues, QueryGeometry, QueryResult } from '@carbonplan/zarr-layer'

// Ported from the @carbonplan/zarr-layer demo (demo/components/controls.tsx),
// which already solves point/region querying against a ZarrLayer instance —
// reused here rather than reimplemented.

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat))

const normalizeLng = (lng: number) => {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

export interface BoundsLike {
  getWest(): number
  getEast(): number
  getSouth?(): number
  getNorth?(): number
  toArray(): [number, number][]
}

/** Current map viewport -> a query geometry, splitting at the antimeridian if crossed. */
export function boundsToGeometry(bounds: BoundsLike): QueryGeometry {
  const arr = bounds.toArray() as [[number, number], [number, number]]
  const [[, swLat], [, neLat]] = arr
  let south = clampLat(Math.min(swLat, neLat))
  let north = clampLat(Math.max(swLat, neLat))
  if (bounds.getSouth) south = clampLat(bounds.getSouth())
  if (bounds.getNorth) north = clampLat(bounds.getNorth())

  const rawWest = bounds.getWest()
  const rawEast = bounds.getEast()

  // World-spanning viewport (e.g. zoomed all the way out): -180/180 both
  // normalize to the same tie-broken value below, which would otherwise
  // collapse to a zero-width polygon. Query the whole globe instead.
  if (rawEast - rawWest >= 360) {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [-180, south],
          [-180, north],
          [180, north],
          [180, south],
          [-180, south],
        ],
      ],
    }
  }

  const west = normalizeLng(rawWest)
  const east = normalizeLng(rawEast)

  if (east >= west) {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      ],
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, south],
          [west, north],
          [180, north],
          [180, south],
          [west, south],
        ],
      ],
      [
        [
          [-180, south],
          [-180, north],
          [east, north],
          [east, south],
          [-180, south],
        ],
      ],
    ],
  }
}

/**
 * Latitude zones the lab defines by name (Lab 1, p.5, "Terminology for this
 * class"): tropics 30S-30N, mid-latitudes 30-60, high latitudes poleward of 60.
 *
 * Task 4c/4d ask for per-hemisphere min/max in January and July. Reading those
 * off a hand-panned viewport makes the numbers irreproducible between lab
 * partners, so the zones are fixed here and queried exactly rather than via
 * whatever the map happens to be showing.
 */
export interface Zone {
  label: string
  south: number
  north: number
}

export const ZONES: Zone[] = [
  { label: 'Global', south: -90, north: 90 },
  { label: 'N hemisphere', south: 0, north: 90 },
  { label: 'S hemisphere', south: -90, north: 0 },
  { label: 'Tropics', south: -30, north: 30 },
  { label: 'Mid-lat N', south: 30, north: 60 },
  { label: 'Mid-lat S', south: -60, north: -30 },
  { label: 'Arctic', south: 60, north: 90 },
  { label: 'Antarctic', south: -90, north: -60 },
]

/** A full-longitude band as a query geometry. */
export function zoneGeometry(zone: Zone): QueryGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [-180, zone.south],
        [-180, zone.north],
        [180, zone.north],
        [180, zone.south],
        [-180, zone.south],
      ],
    ],
  }
}

/**
 * A parallel traced with a vertex every `step` degrees of longitude. Two
 * corners alone would be drawn as a geodesic under the globe projection, so a
 * line at 30N would bow toward the pole between them.
 */
function parallel(lat: number, step = 5): [number, number][] {
  const points: [number, number][] = []
  for (let lon = -180; lon < 180; lon += step) points.push([lon, lat])
  points.push([180, lat])
  return points
}

/** A full-longitude latitude band as a closed ring. */
function bandRing(south: number, north: number): [number, number][] {
  return [...parallel(south), ...parallel(north).reverse(), [-180, south]]
}

/**
 * The zone's boundary parallels. A polar zone has only one — its pole-side
 * edge collapses to a point, and drawing it produces a spiral through the pole.
 */
export function zoneOutlineGeometry(zone: Zone): GeoJSON.MultiLineString {
  const lines: [number, number][][] = []
  if (zone.south > -90) lines.push(parallel(zone.south))
  if (zone.north < 90) lines.push(parallel(zone.north))
  return { type: 'MultiLineString', coordinates: lines }
}

/**
 * Everything *outside* the zone, so a translucent fill dims the rest of the
 * map. Built as the one or two latitude bands that flank the zone rather than
 * as the world with the zone punched out: for a polar zone that hole has a
 * zero-length edge along the pole, and earcut fans the degenerate ring into a
 * pinwheel across the cap.
 */
export function zoneMaskGeometry(zone: Zone): GeoJSON.MultiPolygon {
  const bands: [number, number][][][] = []
  if (zone.south > -90) bands.push([bandRing(-90, zone.south)])
  if (zone.north < 90) bands.push([bandRing(zone.north, 90)])
  return { type: 'MultiPolygon', coordinates: bands }
}

function collectNumbers(
  values: QueryDataValues | undefined,
  fillValue: number,
  depth = 0,
): number[] {
  if (!values || depth > 10) return []

  if (Array.isArray(values)) {
    return values.filter(
      (v): v is number =>
        v !== fillValue && typeof v === 'number' && Number.isFinite(v),
    )
  }
  if (typeof values !== 'object' || values === null) return []

  let results: number[] = []
  for (const entry of Object.values(values)) {
    if (entry === values) continue
    results = results.concat(
      collectNumbers(entry as QueryDataValues, fillValue, depth + 1),
    )
  }
  return results
}

export interface RegionStats {
  /** Area-weighted, i.e. each cell weighted by cos(latitude). */
  mean: number
  min: number
  max: number
  count: number
  /** False when coordinates were unusable and `mean` fell back to unweighted. */
  weighted: boolean
}

const LAT_KEYS = ['lat', 'latitude', 'y']

/** Per-pixel latitudes from a query result, or null if they are unusable. */
function pixelLatitudes(result: QueryResult): number[] | null {
  const coords = result.coordinates
  if (!coords || typeof coords !== 'object') return null
  const key = LAT_KEYS.find((k) => Array.isArray(coords[k]))
  if (!key) return null
  const lats = coords[key]
  if (!lats.every((v): v is number => typeof v === 'number')) return null
  return lats
}

/**
 * Reduce a region queryData() result to min/max/count and an *area-weighted*
 * mean for one variable.
 *
 * The weighting is not cosmetic. On CERES' 1-degree grid an unweighted mean
 * over a lat/lon box counts a polar cell as heavily as an equatorial one that
 * covers ~100x more area, which is wrong by tens of W/m2 for any hemispheric
 * or global average. Lab 2 Task 2 turns exactly such a number (total reflected
 * SW ~105 W/m2) into a planetary albedo, so an unweighted mean propagates
 * straight into a wrong graded answer.
 *
 * min/max/count are unweighted by nature, and are what Lab 1 Task 4d needs.
 */
export function getRegionStats(
  result: QueryResult | null,
  variable: string,
  fillValue: number,
): RegionStats | null {
  if (!result) return null
  const value = result[variable]
  if (!value || typeof value !== 'object') return null

  const valid = (n: unknown): n is number =>
    typeof n === 'number' && n !== fillValue && Number.isFinite(n)

  // Weighting needs each value paired with its own latitude, which only holds
  // for the flat (single-index selector) case where the coordinate array runs
  // parallel to the values. Anything else falls back to an unweighted mean
  // rather than silently pairing the wrong cells.
  const lats = pixelLatitudes(result)
  if (Array.isArray(value) && lats && lats.length === value.length) {
    let wsum = 0
    let weight = 0
    let min = Infinity
    let max = -Infinity
    let count = 0
    for (let i = 0; i < value.length; i++) {
      const v = value[i]
      if (!valid(v)) continue
      const w = Math.cos((lats[i] * Math.PI) / 180)
      wsum += v * w
      weight += w
      if (v < min) min = v
      if (v > max) max = v
      count++
    }
    if (count === 0 || weight === 0) return null
    return { mean: wsum / weight, min, max, count, weighted: true }
  }

  const numbers = collectNumbers(value as QueryDataValues, fillValue, 0)
  if (numbers.length === 0) return null

  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const n of numbers) {
    sum += n
    if (n < min) min = n
    if (n > max) max = n
  }
  return {
    mean: sum / numbers.length,
    min,
    max,
    count: numbers.length,
    weighted: false,
  }
}

/** Read the single value out of a point queryData() result for one variable. */
export function getPointValue(
  result: QueryResult | null,
  variable: string,
  fillValue: number,
): number | null {
  if (!result) return null
  const value = result[variable]
  if (!Array.isArray(value)) return null
  const v = value[0]
  if (typeof v !== 'number' || v === fillValue || !Number.isFinite(v)) return null
  return v
}

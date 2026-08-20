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
 * A few zones also carry `west`/`east` — Lab 2 Task 4 names two lon/lat boxes
 * (western tropical Pacific, North Pacific) rather than latitude bands.
 *
 * Reading region stats off a hand-panned viewport makes the numbers
 * irreproducible between lab partners, so every zone the labs ask about is
 * fixed here and queried exactly rather than via whatever the map happens to
 * be showing.
 */
export interface Zone {
  label: string
  south: number
  north: number
  /** Longitude bounds, in degrees. Omitted = the full band (all longitudes).
   * May wrap the antimeridian (west > east), e.g. Japan-to-Alaska. */
  west?: number
  east?: number
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
  // Lab 2 Task 4a: "western tropical Pacific (near Indonesia and northern
  // Australia)". Sumatra to the Solomon Islands, equator-straddling.
  { label: 'W. tropical Pacific', south: -10, north: 10, west: 95, east: 160 },
  // Lab 2 Task 4b: "North Pacific (between Japan and Alaska)". Crosses the
  // antimeridian, hence west (140E) > east (-130W) here.
  { label: 'N. Pacific (Japan–Alaska)', south: 30, north: 60, west: 140, east: -130 },
]

/** `zone`'s longitude bounds, or null for the existing full-band zones. */
function lonBounds(zone: Zone): { west: number; east: number } | null {
  return zone.west != null && zone.east != null
    ? { west: zone.west, east: zone.east }
    : null
}

/**
 * `zone` as a map camera target: [[west, south], [east, north]]. East is left
 * unwrapped past 180 when the zone crosses the antimeridian (Japan-Alaska),
 * same trick as the render geometry — maplibre's fitBounds reads a plain
 * numeric span, so a wrapped east < west would fit the *wrong* (long) side
 * of the globe.
 *
 * A full-band zone has no natural east/west, and fitting the literal -180/180
 * span forces the camera to zoom out until the whole globe fits (since a
 * sphere shows at most ~180 degrees of longitude at once, no zoom level
 * satisfies a 360-degree request except "very far away"). Centered on
 * wherever the camera already is instead, so the pan stays local and the
 * zoom only has to satisfy the latitude span.
 */
export function zoneBounds(
  zone: Zone,
  currentLng = 0,
): [[number, number], [number, number]] {
  const lon = lonBounds(zone)
  if (!lon) {
    return [
      [currentLng - 90, zone.south],
      [currentLng + 90, zone.north],
    ]
  }
  const { west, east } = lon
  return [
    [west, zone.south],
    [east >= west ? east : east + 360, zone.north],
  ]
}

/** A full-band or lon/lat-boxed zone as a query geometry, split at the
 * antimeridian if the box wraps it. */
export function zoneGeometry(zone: Zone): QueryGeometry {
  const lon = lonBounds(zone)
  if (!lon) {
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
  const { west, east } = lon
  if (east >= west) {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [west, zone.south],
          [west, zone.north],
          [east, zone.north],
          [east, zone.south],
          [west, zone.south],
        ],
      ],
    }
  }
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, zone.south],
          [west, zone.north],
          [180, zone.north],
          [180, zone.south],
          [west, zone.south],
        ],
      ],
      [
        [
          [-180, zone.south],
          [-180, zone.north],
          [east, zone.north],
          [east, zone.south],
          [-180, zone.south],
        ],
      ],
    ],
  }
}

/**
 * A parallel traced with a vertex every `step` degrees of longitude. Two
 * corners alone would be drawn as a geodesic under the globe projection, so a
 * line at 30N would bow toward the pole between them.
 */
function parallel(lat: number, step = 2): [number, number][] {
  const points: [number, number][] = []
  for (let lon = -180; lon < 180; lon += step) points.push([lon, lat])
  points.push([180, lat])
  return points
}

/**
 * Points from `west` to `east` along latitude `lat`, going the direction that
 * increases longitude — wrapping through 180 when `east < west` — stepped for
 * the same globe-bowing reason as `parallel`.
 *
 * Longitude is left to run past +-180 rather than folded back into range: a
 * fold turns a dateline crossing into a coordinate that jumps ~360 degrees
 * between consecutive points, which earcut/line tessellation reads as a real
 * edge spanning most of the map. Unwrapped values project to the same
 * on-globe position and stay a short, continuous edge.
 */
function parallelBetween(
  lat: number,
  west: number,
  east: number,
  step = 2,
): [number, number][] {
  const span = east >= west ? east - west : 360 - west + east
  const n = Math.max(1, Math.ceil(span / step))
  const points: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const lon = west + (span * i) / n
    points.push([lon, lat])
  }
  return points
}

/** A meridian traced with a vertex every `step` degrees of latitude, for the
 * same globe-bowing reason as `parallel`. */
function meridian(lon: number, south: number, north: number, step = 3): [number, number][] {
  const points: [number, number][] = []
  for (let lat = south; lat < north; lat += step) points.push([lon, lat])
  points.push([lon, north])
  return points
}

/** A full-longitude latitude band as a closed ring. */
function bandRing(south: number, north: number): [number, number][] {
  return [...parallel(south), ...parallel(north).reverse(), [-180, south]]
}

/**
 * The zone's boundary. A full-band zone draws its one or two parallels (a
 * polar zone has only one — its pole-side edge collapses to a point, and
 * drawing it produces a spiral through the pole). A lon/lat box draws all
 * four edges.
 */
export function zoneOutlineGeometry(zone: Zone): GeoJSON.MultiLineString {
  const lon = lonBounds(zone)
  if (!lon) {
    const lines: [number, number][][] = []
    if (zone.south > -90) lines.push(parallel(zone.south))
    if (zone.north < 90) lines.push(parallel(zone.north))
    return { type: 'MultiLineString', coordinates: lines }
  }
  const { west, east } = lon
  return {
    type: 'MultiLineString',
    coordinates: [
      parallelBetween(zone.south, west, east),
      parallelBetween(zone.north, west, east),
      meridian(west, zone.south, zone.north),
      meridian(east, zone.south, zone.north),
    ],
  }
}

/**
 * Everything *outside* the zone, so a translucent fill dims the rest of the
 * map. Built as the two or three regions that flank the zone — latitude caps
 * above/below it, plus (for a box) the longitude slice at its own latitude
 * that sits outside [west, east] — rather than as the world with the zone
 * punched out as a hole: for a zone touching a pole that hole has a
 * zero-length edge along the pole, and earcut fans the degenerate ring into a
 * pinwheel across the cap.
 */
export function zoneMaskGeometry(zone: Zone): GeoJSON.MultiPolygon {
  const bands: [number, number][][][] = []
  if (zone.south > -90) bands.push([bandRing(-90, zone.south)])
  if (zone.north < 90) bands.push([bandRing(zone.north, 90)])
  const lon = lonBounds(zone)
  if (lon) {
    // The complementary longitude arc — from `east` back around to `west` —
    // is exactly "everything outside the box", by the same forward-wrapping
    // convention `zoneGeometry` uses for the box itself.
    const { west, east } = lon
    const flank: [number, number][] = [
      ...parallelBetween(zone.south, east, west),
      ...parallelBetween(zone.north, east, west).reverse(),
      [east, zone.south],
    ]
    bands.push([flank])
  }
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

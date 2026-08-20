import type { QueryDataValues, QueryResult } from '@carbonplan/zarr-layer'
import type { ArrayMeta } from '@/lib/store-schema'
import { isSpatial } from '@/lib/config'
import { getRegionStats, type RegionStats } from '@/lib/query'
import type { Selector } from '@/lib/store'

/**
 * A series over one dimension: the same region reduced once per index along
 * `time` (or `month`/`season`/`year` in the climatology groups).
 *
 * zarr-layer already does the fetching. `queryData` takes an array selector —
 * `{ time: { selected: [0, 1, 2, …] } }` — and returns values nested by index,
 * so a whole series is one call rather than one call per step.
 */

/**
 * The dimension a series runs over: the variable's first non-spatial dim.
 * CERES arrays have exactly one, so there is no ambiguity to resolve.
 */
export function seriesDim(v: ArrayMeta | undefined): string | null {
  return v?.dims.find((d) => !isSpatial(d)) ?? null
}

/** Length of `dim` for `v`, i.e. how many points the series has. */
export function seriesLength(v: ArrayMeta, dim: string): number {
  const i = v.dims.indexOf(dim)
  return i < 0 ? 0 : v.shape[i]
}

/**
 * Select every index along `dim`, pinning any other non-spatial dimension at
 * the index the map is currently showing.
 */
export function seriesSelector(
  indices: Record<string, number>,
  dim: string,
  length: number,
): Selector {
  const selector: Selector = {}
  for (const [d, i] of Object.entries(indices)) {
    if (d === dim) continue
    selector[d] = { selected: i, type: 'index' }
  }
  selector[dim] = {
    selected: Array.from({ length }, (_, i) => i),
    type: 'index',
  }
  return selector
}

export interface SeriesPoint extends RegionStats {
  index: number
}

/**
 * Reduce a nested queryData() result to one stat per index.
 *
 * Each nested entry is the flat per-pixel array for one index, over the same
 * pixels in the same order, so `coordinates` is shared across all of them and
 * `getRegionStats` can be reused verbatim — including its cos(latitude)
 * weighting, which matters just as much here as for a single-step readout.
 *
 * Indices with no valid data (a polar region in polar night, say) are dropped
 * rather than plotted as zero.
 */
export function getSeries(
  result: QueryResult | null,
  variable: string,
  fillValue: number,
  length: number,
): SeriesPoint[] {
  if (!result) return []
  const values = result[variable]
  if (!values || typeof values !== 'object' || Array.isArray(values)) return []

  const points: SeriesPoint[] = []
  for (let i = 0; i < length; i++) {
    const slice = (values as Record<number, QueryDataValues>)[i]
    if (!slice) continue
    const stats = getRegionStats(
      {
        [variable]: slice,
        dimensions: result.dimensions,
        coordinates: result.coordinates,
      } as QueryResult,
      variable,
      fillValue,
    )
    if (stats) points.push({ index: i, ...stats })
  }
  return points
}

/** Stable cache key for a query geometry. */
export function geometryKey(geometry: unknown): string {
  return JSON.stringify(geometry)
}

import type { ArrayMeta } from '@/lib/store-schema'
import { coordFor } from '@/lib/crs'

/**
 * Label a time index without reading the coordinate array.
 *
 * The store-schema walk only reads metadata, not chunk data, so we never see
 * the actual time values. CERES carries enough in its attrs to reconstruct
 * them: `units: "days since 2015-01-15 00:00:00"` gives the epoch and
 * `delta_t: "0000-00-01 00:00:00"` gives a fixed 1-month step. When either is
 * missing we fall back to the bare index.
 */

interface TimeAxis {
  epoch: Date
  stepMonths?: number
  stepDays?: number
}

function parseTimeAxis(coord?: ArrayMeta): TimeAxis | null {
  const units = String(coord?.attrs?.['units'] ?? '')
  const m = units.match(
    /^(\w+)\s+since\s+(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/,
  )
  if (!m) return null
  const epoch = new Date(
    Date.UTC(
      Number(m[2]),
      Number(m[3]) - 1,
      Number(m[4]),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
      Number(m[7] ?? 0),
    ),
  )

  // delta_t is "YYYY-MM-DD hh:mm:ss" expressed as an interval, e.g. monthly is
  // "0000-00-01 00:00:00" (one month) despite living in the day slot.
  const dt = String(coord?.attrs?.['delta_t'] ?? '')
  const d = dt.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (d) {
    const [years, months, days] = [Number(d[1]), Number(d[2]), Number(d[3])]
    if (years || months) return { epoch, stepMonths: years * 12 + months }
    // CERES encodes a monthly step as 01 in the day field.
    if (days === 1) return { epoch, stepMonths: 1 }
    if (days) return { epoch, stepDays: days }
  }
  return { epoch }
}

const MONTH_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const SEASON_NAMES = ['DJF', 'MAM', 'JJA', 'SON']

/**
 * Climatology groups are keyed on `month` (1-12), `season` (DJF..SON), and
 * `year`. month/season are fixed orderings, so they label from the index
 * alone. `year` is a contiguous run starting at `first_year` (an attr set in
 * process.ipynb), so it labels from the index plus that offset.
 */
function formatClimatologyIndex(
  dim: string,
  index: number,
  coord?: ArrayMeta,
): string | null {
  if (dim === 'month') return MONTH_NAMES[index] ?? null
  if (dim === 'season') return SEASON_NAMES[index] ?? null
  if (dim === 'year') {
    const firstYear = coord?.attrs?.['first_year']
    if (typeof firstYear === 'number') return String(firstYear + index)
  }
  return null
}

/** Human label for index `i` along `dim`, or `null` if it isn't a datetime axis. */
export function formatTimeIndex(
  dim: string,
  index: number,
  arrays: ArrayMeta[],
  group?: string,
): string | null {
  const coord = coordFor(dim, arrays, group)
  const climatology = formatClimatologyIndex(dim, index, coord)
  if (climatology) return climatology

  const axis = parseTimeAxis(coord)
  if (!axis) return null

  const d = new Date(axis.epoch)
  if (axis.stepMonths) {
    d.setUTCMonth(d.getUTCMonth() + index * axis.stepMonths)
    return MONTH_FMT.format(d)
  }
  if (axis.stepDays) {
    d.setUTCDate(d.getUTCDate() + index * axis.stepDays)
    return DAY_FMT.format(d)
  }
  return null
}

export const isTimeDim = (d: string) => /^(time|t)$/i.test(d)

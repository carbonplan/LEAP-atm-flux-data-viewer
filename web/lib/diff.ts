import * as zarr from 'zarrita'
import {
  isSpatial,
  quantityKind,
  RADIATIVE_FLUX_KINDS,
  units,
} from '@/lib/config'
import type { ArrayMeta } from '@/lib/store-schema'

/**
 * Path the difference layer is rendered under. zarr-layer takes one variable
 * per layer and cannot sample two arrays in one shader, so A - B is computed
 * here and served back to it as an ordinary (synthetic) zarr array.
 */
export const DIFF_PATH = '__diff__'

export interface DiffSlice {
  /** Synthetic store entries, keyed by absolute path. */
  entries: Map<string, Uint8Array>
  /** Robust symmetric color range. Computed on first read: the map only asks
   * for it when the variable pair changes, not on every time step. */
  readonly clim: [number, number]
}

/** Two variables can be subtracted only if they measure the same thing. */
export function sameUnits(a: ArrayMeta, b: ArrayMeta): boolean {
  return units(a) === units(b)
}

/**
 * Whether `a - b` means anything physically.
 *
 * Matching units is necessary but not sufficient: albedo and cloud area
 * fraction are both "percent". Require the same quantity, or two quantities
 * that are both radiative fluxes in W m-2.
 */
export function diffCompatible(a: ArrayMeta, b: ArrayMeta): boolean {
  if (!sameUnits(a, b)) return false
  const ka = quantityKind(a.name)
  const kb = quantityKind(b.name)
  if (ka === kb) return true
  return RADIATIVE_FLUX_KINDS.has(ka) && RADIATIVE_FLUX_KINDS.has(kb)
}

/** Which key a pane's queryData result is filed under. */
export function valueKey(pane: {
  variable: string
  diffWith: string | null
}): string {
  return pane.diffWith ? DIFF_PATH : pane.variable
}

interface RangeQuery {
  offset?: number
  length?: number
  suffixLength?: number
}

interface Backing {
  get(key: string, opts?: unknown): Promise<Uint8Array | undefined>
  getRange?(
    key: string,
    range: RangeQuery,
    opts?: unknown,
  ): Promise<Uint8Array | undefined>
}

/**
 * Readable that answers for the synthetic difference array and delegates
 * everything else. Proxying rather than faking the whole store keeps the real
 * coordinate arrays and group metadata reachable — and `getRange` has to be
 * forwarded, because the CERES arrays are sharded and zarrita refuses to open
 * a sharded array through a store that cannot serve byte ranges.
 */
export function diffStore(
  base: zarr.Readable,
  entries: Map<string, Uint8Array>,
): zarr.Readable {
  const backing = base as unknown as Backing
  const proxy: Backing = {
    get(key, opts) {
      const own = entries.get(key)
      if (own || key.startsWith(`/${DIFF_PATH}/`)) return Promise.resolve(own)
      return backing.get(key, opts)
    },
  }
  if (backing.getRange) {
    proxy.getRange = (key, range, opts) => {
      const own = entries.get(key)
      if (own || key.startsWith(`/${DIFF_PATH}/`)) {
        // The synthetic array is unsharded and single-chunk, so this is only
        // ever reached by a speculative range read; answer it anyway.
        if (!own) return Promise.resolve(undefined)
        const start = range.suffixLength
          ? Math.max(0, own.length - range.suffixLength)
          : (range.offset ?? 0)
        const end = range.length ? start + range.length : own.length
        return Promise.resolve(own.subarray(start, end))
      }
      return backing.getRange!(key, range, opts)
    }
  }
  return proxy as unknown as zarr.Readable
}

/** CF unpacking. zarrita returns raw stored values; zarr-layer would normally
 * apply these on the GPU, but we subtract before it ever sees the data. */
function cfScale(meta: ArrayMeta): { scale: number; offset: number } {
  const a = meta.attrs ?? {}
  return {
    scale: typeof a['scale_factor'] === 'number' ? a['scale_factor'] : 1,
    offset: typeof a['add_offset'] === 'number' ? a['add_offset'] : 0,
  }
}

/** One lat/lon slice of `meta`, unpacked to float32 with fills as NaN. */
async function readSlice(
  store: zarr.Readable,
  meta: ArrayMeta,
  indices: Record<string, number>,
): Promise<{ data: Float32Array; shape: number[] }> {
  const arr = await zarr.open(zarr.root(store).resolve(`/${meta.path}`), {
    kind: 'array',
  })
  const selection = meta.dims.map((d) => (isSpatial(d) ? null : (indices[d] ?? 0)))
  const chunk = await zarr.get(arr, selection as (number | null)[])
  const raw = chunk.data as ArrayLike<number>
  const { scale, offset } = cfScale(meta)
  // `fillValue` is a bigint for 64-bit integer dtypes, and `1 === 1n` is false,
  // so compare as numbers. Absent fill becomes NaN, which matches nothing.
  const rawFill = arr.fillValue
  const fill =
    typeof rawFill === 'number' || typeof rawFill === 'bigint'
      ? Number(rawFill)
      : NaN
  const out = new Float32Array(raw.length)
  for (let i = 0; i < out.length; i++) {
    const v = Number(raw[i])
    out[i] = v === fill || !Number.isFinite(v) ? NaN : v * scale + offset
  }
  return { data: out, shape: chunk.shape as number[] }
}

/** Robust symmetric range: 98th percentile of |value|, rounded outwards. */
export function diffClim(values: Float32Array): [number, number] {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) finite.push(Math.abs(values[i]))
  }
  if (finite.length === 0) return [-1, 1]
  finite.sort((x, y) => x - y)
  const m = finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.98))]
  if (!m) return [-1, 1]
  // ~3 significant digits, widened so rounding never clips data off the ramp.
  // Clamped: a denormal `m` would otherwise send `p` to Infinity and `hi` to NaN.
  const decimals = Math.min(12, Math.max(0, 2 - Math.floor(Math.log10(m))))
  const p = 10 ** decimals
  const hi = Math.ceil(m * p) / p
  return [-hi, hi]
}

/**
 * Metadata for the synthetic array. Deliberately the most boring zarr v3 an
 * implementation can serve: one chunk, no compression, so the chunk body is
 * just the float32 buffer.
 */
function diffMeta(shape: number[], dims: string[]) {
  return {
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: 'float32',
    chunk_grid: { name: 'regular', configuration: { chunk_shape: shape } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    fill_value: 'NaN',
    dimension_names: dims,
    attributes: {},
  }
}

const cache = new Map<string, Promise<DiffSlice>>()
const CACHE_MAX = 24

/** Cache keys have to be per-store: the same variable path in a different
 * store is different data. */
const storeIds = new WeakMap<object, string>()
let nextStoreId = 0
function storeId(store: zarr.Readable): string {
  const k = store as unknown as object
  let id = storeIds.get(k)
  if (!id) {
    id = `s${nextStoreId++}`
    storeIds.set(k, id)
  }
  return id
}

/**
 * A - B for one time step, packaged as store entries zarr-layer can render.
 * Cached per (a, b, indices) so scrubbing the time slider back over a step
 * already visited costs nothing.
 */
export function computeDiff(
  store: zarr.Readable,
  a: ArrayMeta,
  b: ArrayMeta,
  indices: Record<string, number>,
): Promise<DiffSlice> {
  const key = `${storeId(store)}|${a.path}|${b.path}|${JSON.stringify(indices)}`
  const hit = cache.get(key)
  if (hit) {
    // Re-insert so eviction below is LRU rather than insertion-order.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const promise = (async (): Promise<DiffSlice> => {
    const [sa, sb] = await Promise.all([
      readSlice(store, a, indices),
      readSlice(store, b, indices),
    ])
    if (sa.data.length !== sb.data.length) {
      throw new Error(
        `${a.name} and ${b.name} are on different grids (${sa.shape} vs ${sb.shape})`,
      )
    }
    const diff = new Float32Array(sa.data.length)
    for (let i = 0; i < diff.length; i++) diff[i] = sa.data[i] - sb.data[i]

    const dims = a.dims.filter(isSpatial)
    if (dims.length !== sa.shape.length) {
      throw new Error(
        `${a.name} has ${sa.shape.length} spatial axes but ${dims.length} spatial dimension names`,
      )
    }
    const entries = new Map<string, Uint8Array>()
    entries.set(
      `/${DIFF_PATH}/zarr.json`,
      new TextEncoder().encode(JSON.stringify(diffMeta(sa.shape, dims))),
    )
    // One chunk, so every chunk-grid coordinate is 0 — but write the key at the
    // array's real rank instead of assuming lat/lon.
    entries.set(
      `/${DIFF_PATH}/c/${sa.shape.map(() => 0).join('/')}`,
      new Uint8Array(diff.buffer, diff.byteOffset, diff.byteLength),
    )
    let clim: [number, number] | null = null
    return {
      entries,
      get clim() {
        if (!clim) clim = diffClim(diff)
        return clim
      },
    }
  })().catch((err) => {
    cache.delete(key)
    throw err
  })

  cache.set(key, promise)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return promise
}

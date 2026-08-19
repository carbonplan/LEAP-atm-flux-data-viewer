import { IcechunkStore } from 'icechunk-js'

export interface ArrayMeta {
  name: string // leaf name for display
  path: string // path to hand zarr-layer as `variable`
  group: string // owning DataTree group, '' for root
  dtype: string
  shape: number[]
  dims: string[]
  chunks?: number[] // inner chunk shape, i.e. what one fetch decodes
  attrs?: Record<string, unknown>
  // Attrs of the owning DataTree group (e.g. geozarr's spatial:transform),
  // as opposed to `attrs` above which is this array's own metadata.
  groupAttrs?: Record<string, unknown>
  hints?: LayerHint // this variable's entry in the group's `zarr-layer` attr
}

/** Per-variable display hints topozarr writes for zarr-layer, on the group. */
export interface LayerHint {
  clim?: [number, number]
  colormap?: string
}

/**
 * Percentile bounds arrive as full float noise (0.04699999839067459), which is
 * unreadable in the range inputs. Snap to ~3 significant digits of the span,
 * widening outwards so rounding never clips data out of the ramp.
 */
function roundClim([lo, hi]: [number, number]): [number, number] {
  const span = Math.abs(hi - lo)
  if (!span) return [lo, hi]
  const decimals = Math.max(0, 2 - Math.floor(Math.log10(span)))
  const p = 10 ** decimals
  return [Math.floor(lo * p) / p, Math.ceil(hi * p) / p]
}

/**
 * One variable's hint out of a group's `zarr-layer` attr. topozarr serialises the
 * whole dataclass, so absent fields arrive as explicit nulls; drop those rather
 * than let them shadow the inferred defaults.
 */
export function layerHint(
  groupAttrs: Record<string, unknown> | undefined,
  name: string,
): LayerHint | undefined {
  const all = groupAttrs?.['zarr-layer'] as Record<string, unknown> | undefined
  const raw = all?.[name] as { clim?: unknown; colormap?: unknown } | undefined
  if (!raw || typeof raw !== 'object') return undefined

  const hint: LayerHint = {}
  const clim = raw.clim
  if (Array.isArray(clim) && clim.length === 2) {
    const [lo, hi] = clim.map(Number)
    if (Number.isFinite(lo) && Number.isFinite(hi))
      hint.clim = roundClim([lo, hi])
  }
  if (typeof raw.colormap === 'string' && raw.colormap) {
    hint.colormap = raw.colormap
  }
  return hint.clim || hint.colormap ? hint : undefined
}

export function dimsFromArrays(arrays: ArrayMeta[]): Record<string, number> {
  const dims: Record<string, number> = {}
  for (const a of arrays) {
    a.dims.forEach((d, i) => {
      if (d && dims[d] === undefined && a.shape[i] !== undefined)
        dims[d] = a.shape[i]
    })
  }
  return dims
}

// Open an icechunk store; caller reuses it for both schema and the map layer.
export async function openIcechunkStore(
  httpUrl: string,
  signal?: AbortSignal,
): Promise<IcechunkStore> {
  return IcechunkStore.open(httpUrl, { signal })
}

/**
 * Pyramid level prefixes declared on the root group, or [] for a flat store.
 *
 * This matters because zarr-layer builds its array key as `${level}/${variable}`
 * when a store is multiscale. So for a pyramid we must hand it the *bare*
 * variable name and let it choose the level, whereas for a plain DataTree the
 * group path has to stay part of `variable`. Getting this backwards either
 * double-prefixes the key or drops the group.
 */
export function levelPrefixes(store: IcechunkStore): string[] {
  const root = store.getMetadata('/') as Record<string, unknown> | null
  const attrs = root?.attributes as Record<string, unknown> | undefined
  const ms = attrs?.['multiscales']

  // zarr-conventions/multiscales: { layout: [{ asset: '0' }, ...] }
  const layout = (ms as { layout?: Array<{ asset?: unknown }> })?.layout
  if (Array.isArray(layout)) {
    return layout.map((l) => String(l.asset)).filter(Boolean)
  }

  // OME-NGFF: [{ datasets: [{ path: '0' }, ...] }]
  if (Array.isArray(ms) && ms[0]?.datasets?.length) {
    return (ms[0].datasets as Array<{ path?: unknown }>)
      .map((d) => String(d.path))
      .filter(Boolean)
  }

  return []
}

// Walk an already-open icechunk store. Reads each array node's parsed Zarr v3
// metadata for dtype/shape/chunks/dims/attrs.
export function arraysFromStore(store: IcechunkStore): ArrayMeta[] {
  const levels = levelPrefixes(store)
  // On a pyramid, every level holds the same variables; describe the finest one
  // and strip its prefix so `variable` is the bare name zarr-layer expects.
  const stripPrefix = levels.length > 0 ? `${levels[0]}/` : null

  const arrays: ArrayMeta[] = []
  const groupAttrsCache = new Map<string, Record<string, unknown> | undefined>()
  const groupAttrs = (group: string): Record<string, unknown> | undefined => {
    if (!groupAttrsCache.has(group)) {
      const meta = store.getMetadata(group ? `/${group}` : '/') as Record<
        string,
        unknown
      > | null
      groupAttrsCache.set(
        group,
        meta?.attributes as Record<string, unknown> | undefined,
      )
    }
    return groupAttrsCache.get(group)
  }

  for (const node of store.listNodes()) {
    if (node.nodeData?.type !== 'array') continue
    const meta = store.getMetadata(node.path) as Record<string, unknown> | null
    if (!meta) continue

    const full = node.path.replace(/^\//, '')
    if (stripPrefix && !full.startsWith(stripPrefix)) continue
    const path = stripPrefix ? full.slice(stripPrefix.length) : full

    const shape = (meta.shape as number[]) ?? []
    const dn = meta.dimension_names as (string | null)[] | undefined
    const dims = Array.isArray(dn) ? dn.map((d) => d ?? '') : []
    // chunk_grid holds the *shard* shape on a sharded array. Readers fetch the
    // shard index and then only the inner chunk they need, so the inner shape
    // from the sharding codec is the real unit of transfer.
    const chunkGrid = meta.chunk_grid as
      { configuration?: { chunk_shape?: number[] } } | undefined
    const codecs = (meta.codecs ?? []) as Array<{
      name?: string
      configuration?: { chunk_shape?: number[] }
    }>
    const sharding = codecs.find((c) => c.name === 'sharding_indexed')

    const segments = path.split('/').filter(Boolean)
    const group = segments.slice(0, -1).join('/')
    const name = segments[segments.length - 1] ?? path
    // Attrs live at the array's real parent, which on a pyramid still carries
    // the level prefix that `path` has had stripped off.
    const attrs = groupAttrs(full.split('/').slice(0, -1).join('/'))

    arrays.push({
      name,
      path,
      group,
      dtype: String(meta.data_type ?? ''),
      shape,
      dims,
      chunks:
        sharding?.configuration?.chunk_shape ??
        chunkGrid?.configuration?.chunk_shape,
      attrs: meta.attributes as Record<string, unknown> | undefined,
      groupAttrs: attrs,
      hints: layerHint(attrs, name),
    })
  }

  return arrays
}

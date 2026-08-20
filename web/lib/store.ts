import { create } from 'zustand'
import type maplibregl from 'maplibre-gl'
import type {
  QueryGeometry,
  QueryResult,
  ZarrLayer,
} from '@carbonplan/zarr-layer'
import type { Zone } from '@/lib/query'
import type { ArrayMeta } from '@/lib/store-schema'
import {
  DEFAULT_VARS,
  defaultClim,
  defaultColormap,
  isLabVar,
  isSpatial,
  quantityKind,
  renderable,
  skyCondition,
} from '@/lib/config'
import { diffCompatible } from '@/lib/diff'
import { geometryKey, seriesDim, seriesLength, seriesSelector } from '@/lib/series'

export type Selector = Record<
  string,
  { selected: number | number[]; type: 'index' }
>

/**
 * `compare` puts two maps side by side; `diff` keeps one map and renders
 * A minus B, which is the form the cloud-radiative-effect questions actually
 * take ("how much longwave do clouds trap?").
 */
export type ViewMode = 'single' | 'compare' | 'diff'

/**
 * One map pane. Lab 1 Task 2 ("compare your January albedo and January SW
 * maps") and Task 7.2 ("Greenland has high albedo but low reflected SW") are
 * comparisons, so the layer state has to be able to exist twice over.
 */
export interface PaneState {
  variable: string
  clim: [number, number]
  colormap: string
  /** index per non-spatial dimension, e.g. { time: 12 } */
  indices: Record<string, number>
  /** opt-in override for a variable whose chunks exceed MAX_CHUNK_MB */
  force: boolean
  /**
   * In `diff` mode, the path of the variable subtracted from `variable`.
   * `variable` stays a real array either way, so dim sliders, time labels and
   * every other `ArrayMeta` lookup keep working untouched.
   */
  diffWith: string | null
  status: string
  mapInstance: maplibregl.Map | null
  zarrLayer: ZarrLayer | null
  pointResult: QueryResult | null
  regionResult: QueryResult | null
  /** Every index along the series dimension for the last series query. */
  seriesResult: QueryResult | null
}

interface AppState {
  // store introspection
  arrays: ArrayMeta[]
  storeReady: boolean
  error: string | null

  // panes[0] is always live; panes[1] renders only in compare mode
  panes: [PaneState, PaneState]
  mode: ViewMode
  /** Keep the time/month index in step across panes (the Task 2 case). */
  linkTime: boolean
  /** Escape hatch out of the LAB_VARS allowlist. */
  showAll: boolean
  hoverQueryEnabled: boolean
  /** Display-only switches. In the store rather than in `Viewer` so the
   * sidebar can own the controls while the maps consume the values. */
  globe: boolean
  dark: boolean
  /** Anchor the series y-axis at zero instead of fitting it to the data. */
  zeroAnchored: boolean
  /** Zone currently drawn on the map, and whose stats are on screen. */
  activeZone: Zone | null
  /** What the on-screen series covers, and whether one is in flight. */
  seriesLabel: string | null
  seriesLoading: boolean
  /** Last point queried, so a series can be run at the same pixel. */
  lastPoint: [number, number] | null

  setArrays: (arrays: ArrayMeta[]) => void
  setStoreReady: (ready: boolean) => void
  setError: (error: string | null) => void
  setStatus: (pane: number, status: string) => void
  setVariable: (pane: number, path: string) => void
  /** The dataset (DataTree group) is shared: panes always compare like with like. */
  setGroup: (group: string) => void
  setClim: (pane: number, clim: [number, number]) => void
  setColormap: (pane: number, colormap: string) => void
  setIndex: (pane: number, dim: string, index: number) => void
  setForce: (pane: number, force: boolean) => void
  setMapInstance: (pane: number, map: maplibregl.Map | null) => void
  setZarrLayer: (pane: number, layer: ZarrLayer | null) => void
  setPointResult: (pane: number, result: QueryResult | null) => void
  setRegionResult: (pane: number, result: QueryResult | null) => void
  setMode: (mode: ViewMode) => void
  setDiffWith: (path: string | null) => void
  setLinkTime: (linkTime: boolean) => void
  setShowAll: (showAll: boolean) => void
  setGlobe: (globe: boolean) => void
  setDark: (dark: boolean) => void
  setZeroAnchored: (zeroAnchored: boolean) => void
  setHoverQueryEnabled: (enabled: boolean) => void
  setActiveZone: (zone: Zone | null) => void
  clearResults: () => void

  /** Fire a query against every live pane, so one click reads both maps. */
  queryPoint: (
    lngLat: [number, number],
    options?: { signal?: AbortSignal },
  ) => Promise<void>
  queryRegion: (geometry: QueryGeometry) => Promise<void>
  /**
   * Reduce the same geometry once per index along the series dimension. One
   * `queryData` call per pane, with the whole axis selected.
   */
  querySeries: (geometry: QueryGeometry, label: string) => Promise<void>
  clearSeries: () => void
}

function emptyPane(): PaneState {
  return {
    variable: '',
    clim: [0, 1],
    colormap: 'warm',
    indices: {},
    force: false,
    diffWith: null,
    status: '',
    mapInstance: null,
    zarrLayer: null,
    pointResult: null,
    regionResult: null,
    seriesResult: null,
  }
}

/**
 * Variables that can be subtracted from `a`: same dataset group, not `a`
 * itself, and measuring something a subtraction can be taken of. The B dropdown
 * is filtered rather than merely warned about — see `diffCompatible`.
 *
 * Ordered so the same quantity in the opposite sky condition comes first, since
 * every caller takes the head as its default: that makes the default difference
 * an all-sky minus clear-sky, i.e. a cloud radiative effect, which is the
 * comparison the labs actually ask for.
 */
export function diffCandidates(arrays: ArrayMeta[], a: ArrayMeta): ArrayMeta[] {
  const kindA = quantityKind(a.name)
  const skyA = skyCondition(a.name)
  const rank = (v: ArrayMeta) => {
    const kind = quantityKind(v.name)
    // Incoming solar is an input to the budget, not another outgoing flux, so
    // it makes a poor default partner even though the units match.
    if (kind === 'solar' && kindA !== 'solar') return 3
    if (kind !== kindA) return 2
    return skyCondition(v.name) !== skyA ? 0 : 1
  }
  return arrays
    .filter(
      (v) =>
        v.group === a.group &&
        v.path !== a.path &&
        renderable(v) &&
        diffCompatible(a, v),
    )
    .sort((x, y) => rank(x) - rank(y))
}

/** Reset clim, colormap and dim indices to whatever suits `v`. */
function derivedFor(v: ArrayMeta) {
  const indices: Record<string, number> = {}
  v.dims.forEach((d) => {
    if (!isSpatial(d)) indices[d] = 0
  })
  return {
    variable: v.path,
    clim: defaultClim(v),
    colormap: defaultColormap(v),
    indices,
    force: false,
    diffWith: null,
    pointResult: null,
    regionResult: null,
    seriesResult: null,
  }
}

export const useAppStore = create<AppState>((set, get) => {
  /** Apply a patch to one pane without disturbing the other. */
  const patch = (pane: number, next: Partial<PaneState>) =>
    set((s) => {
      const panes = [...s.panes] as [PaneState, PaneState]
      panes[pane] = { ...panes[pane], ...next }
      return { panes }
    })

  /** Panes that currently have a map on screen. */
  const livePanes = (s: AppState) => (s.mode === 'compare' ? [0, 1] : [0])

  return {
    arrays: [],
    storeReady: false,
    error: null,

    panes: [emptyPane(), emptyPane()],
    mode: 'single',
    linkTime: true,
    showAll: false,
    hoverQueryEnabled: false,
    globe: true,
    dark: true,
    zeroAnchored: false,
    activeZone: null,
    seriesLabel: null,
    seriesLoading: false,
    lastPoint: null,

    setArrays: (arrays) => {
      // Land on a named default; then any lab variable; then anything
      // renderable, so the app still works against an unrelated store.
      const renderables = arrays.filter(renderable)
      const preferred = DEFAULT_VARS.map((name) =>
        renderables.find((v) => v.name === name),
      ).find(Boolean)
      const first = preferred ?? renderables.find(isLabVar) ?? renderables[0]
      if (!first) {
        set({ arrays })
        return
      }
      // Seed the second pane with a *different* variable, so switching on
      // compare immediately shows a comparison rather than the same map twice.
      const second =
        renderables.find((v) => v.group === first.group && v.path !== first.path && isLabVar(v)) ??
        first
      set((s) => ({
        arrays,
        panes: [
          { ...s.panes[0], ...derivedFor(first) },
          { ...s.panes[1], ...derivedFor(second) },
        ],
      }))
    },
    setStoreReady: (storeReady) => set({ storeReady }),
    setError: (error) => set({ error }),
    setStatus: (pane, status) => patch(pane, { status }),

    setVariable: (pane, path) => {
      const { arrays, panes, mode } = get()
      const v = arrays.find((a) => a.path === path)
      if (!v) return
      patch(pane, derivedFor(v))
      // derivedFor clears diffWith. In diff mode, re-seed it: keep the same B
      // if it still measures the same thing, otherwise pick a fresh partner.
      if (pane !== 0 || mode !== 'diff') return
      const candidates = diffCandidates(arrays, v)
      const next =
        candidates.find((c) => c.path === panes[0].diffWith) ??
        candidates.find(isLabVar) ??
        candidates[0]
      if (next) get().setDiffWith(next.path)
    },

    setGroup: (group) => {
      const { arrays, panes } = get()
      const inGroup = arrays.filter((a) => a.group === group && renderable(a))
      if (inGroup.length === 0) return
      // Keep looking at the same physical quantity across groups — e.g.
      // switching monthly → climatology should stay on the same flux.
      const next = panes.map((p) => {
        const leaf = arrays.find((a) => a.path === p.variable)?.name
        const match = inGroup.find((a) => a.name === leaf) ?? inGroup[0]
        // derivedFor drops diffWith, so carry B across by leaf name too.
        const bLeaf = arrays.find((a) => a.path === p.diffWith)?.name
        const b = bLeaf ? inGroup.find((a) => a.name === bLeaf) : undefined
        return {
          ...p,
          ...derivedFor(match),
          ...(b && diffCompatible(match, b)
            ? { diffWith: b.path, colormap: 'redteal_r' }
            : {}),
        }
      }) as [PaneState, PaneState]
      set({ panes: next })
    },

    setClim: (pane, clim) => patch(pane, { clim }),
    setColormap: (pane, colormap) => patch(pane, { colormap }),

    setIndex: (pane, dim, index) =>
      set((s) => {
        const panes = s.panes.map((p, i) => {
          // Only mirror onto a pane that actually has this dimension —
          // groups differ (monthly `time` vs climatology `month`).
          const applies = i === pane || (s.linkTime && dim in p.indices)
          if (!applies) return p
          return {
            ...p,
            indices: { ...p.indices, [dim]: index },
            pointResult: null,
            regionResult: null,
          }
        }) as [PaneState, PaneState]
        return { panes }
      }),

    setForce: (pane, force) => patch(pane, { force }),
    setMapInstance: (pane, mapInstance) => patch(pane, { mapInstance }),
    setZarrLayer: (pane, zarrLayer) => patch(pane, { zarrLayer }),
    setPointResult: (pane, pointResult) => patch(pane, { pointResult }),
    setRegionResult: (pane, regionResult) => patch(pane, { regionResult }),

    setMode: (mode) => {
      if (mode !== 'diff') {
        // Leaving diff: the symmetric range and diverging ramp belonged to the
        // difference, not to A, so put A's own defaults back.
        set((s) => {
          const a = s.arrays.find((v) => v.path === s.panes[0].variable)
          return {
            mode,
            panes: [
              {
                ...s.panes[0],
                diffWith: null,
                ...(s.panes[0].diffWith && a
                  ? { clim: defaultClim(a), colormap: defaultColormap(a) }
                  : {}),
              },
              s.panes[1],
            ] as [PaneState, PaneState],
          }
        })
        return
      }
      set((s) => ({ mode, panes: s.panes }))
      // Seed B from the compare pane when it is subtractable, so switching
      // modes keeps the pair the reader already picked.
      const { panes, arrays } = get()
      const a = arrays.find((v) => v.path === panes[0].variable)
      if (!a) return
      const candidates = diffCandidates(arrays, a)
      const seed =
        candidates.find((v) => v.path === panes[1].variable) ??
        candidates.find(isLabVar) ??
        candidates[0]
      if (seed) get().setDiffWith(seed.path)
    },

    setDiffWith: (path) => {
      if (path === null) {
        patch(0, { diffWith: null })
        return
      }
      const { arrays, panes } = get()
      const a = arrays.find((v) => v.path === panes[0].variable)
      const b = arrays.find((v) => v.path === path)
      if (!a || !b || !diffCompatible(a, b)) return
      // A difference straddles zero by construction, so it only reads on a
      // diverging ramp. clim is replaced once the field has been computed.
      patch(0, {
        diffWith: path,
        colormap: 'redteal_r',
        pointResult: null,
        regionResult: null,
        seriesResult: null,
      })
    },
    setLinkTime: (linkTime) => set({ linkTime }),
    setShowAll: (showAll) => set({ showAll }),
    setGlobe: (globe) => set({ globe }),
    setDark: (dark) => set({ dark }),
    setZeroAnchored: (zeroAnchored) => set({ zeroAnchored }),
    setHoverQueryEnabled: (hoverQueryEnabled) => set({ hoverQueryEnabled }),
    setActiveZone: (activeZone) => set({ activeZone }),

    clearResults: () =>
      set((s) => ({
        activeZone: null,
        seriesLabel: null,
        panes: s.panes.map((p) => ({
          ...p,
          pointResult: null,
          regionResult: null,
          seriesResult: null,
        })) as [PaneState, PaneState],
      })),

    clearSeries: () =>
      set((s) => ({
        seriesLabel: null,
        panes: s.panes.map((p) => ({ ...p, seriesResult: null })) as [
          PaneState,
          PaneState,
        ],
      })),

    queryPoint: async (lngLat, options) => {
      const s = get()
      const geometry: QueryGeometry = { type: 'Point', coordinates: lngLat }
      set({ lastPoint: lngLat })
      await Promise.all(
        livePanes(s).map(async (i) => {
          const layer = s.panes[i].zarrLayer
          if (!layer) return
          try {
            const result = await layer.queryData(
              geometry,
              paneSelector(s.panes[i]),
              options,
            )
            if (!options?.signal?.aborted) get().setPointResult(i, result)
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            console.warn('Point query failed', err)
          }
        }),
      )
    },

    queryRegion: async (geometry) => {
      const s = get()
      await Promise.all(
        livePanes(s).map(async (i) => {
          const layer = s.panes[i].zarrLayer
          if (!layer) return
          try {
            const result = await layer.queryData(
              geometry,
              paneSelector(s.panes[i]),
              { includeSpatialCoordinates: true },
            )
            get().setRegionResult(i, result)
          } catch (err) {
            console.warn('Region query failed', err)
            get().setRegionResult(i, null)
          }
        }),
      )
    },

    querySeries: async (geometry, label) => {
      // One in flight at a time: on the monthly group a series is 313 chunk
      // reads, so leaving an abandoned one running would double the traffic
      // every time the reader changes their mind about the region.
      seriesAbort?.abort()
      const controller = new AbortController()
      seriesAbort = controller

      const s = get()
      set({ seriesLoading: true, seriesLabel: label })
      try {
        await Promise.all(
          livePanes(s).map(async (i) => {
            const pane = s.panes[i]
            const layer = pane.zarrLayer
            const v = s.arrays.find((a) => a.path === pane.variable)
            const dim = seriesDim(v)
            // A diff layer is a single precomputed slice with no series
            // dimension left to walk.
            if (!layer || !v || !dim || pane.diffWith) return
            const length = seriesLength(v, dim)
            if (length < 2) return

            const key = `${pane.variable}|${dim}|${JSON.stringify(
              pane.indices,
            )}|${geometryKey(geometry)}`
            try {
              const result = await cachedSeries(key, () =>
                layer.queryData(
                  geometry,
                  seriesSelector(pane.indices, dim, length),
                  {
                    includeSpatialCoordinates: true,
                    signal: controller.signal,
                  },
                ),
              )
              if (controller.signal.aborted) return
              patch(i, { seriesResult: result })
            } catch (err) {
              if (controller.signal.aborted) return
              console.warn('Series query failed', err)
              patch(i, { seriesResult: null })
            }
          }),
        )
      } finally {
        if (seriesAbort === controller) {
          seriesAbort = null
          set({ seriesLoading: false })
        }
      }
    },
  }
})

let seriesAbort: AbortController | null = null

/**
 * LRU over completed series, keyed by variable + pinned indices + geometry.
 * Re-picking a region already queried is free, which matters when the query
 * behind it is hundreds of ranged reads. Same shape as the slice cache in
 * `lib/diff.ts`.
 */
const seriesCache = new Map<string, QueryResult>()
const SERIES_CACHE_MAX = 12

async function cachedSeries(
  key: string,
  run: () => Promise<QueryResult>,
): Promise<QueryResult> {
  const hit = seriesCache.get(key)
  if (hit) {
    // Re-insert so eviction below is LRU rather than insertion-order.
    seriesCache.delete(key)
    seriesCache.set(key, hit)
    return hit
  }
  const result = await run()
  seriesCache.set(key, result)
  if (seriesCache.size > SERIES_CACHE_MAX) {
    seriesCache.delete(seriesCache.keys().next().value as string)
  }
  return result
}

/**
 * The selector to query a pane's layer with. A difference layer is a single
 * lat/lon slice with the dimension already applied, so it takes none.
 */
function paneSelector(pane: PaneState): Selector {
  return pane.diffWith ? {} : toSelector(pane.indices)
}

/** Shape the flat index map into the selector zarr-layer expects. */
export function toSelector(indices: Record<string, number>): Selector {
  const selector: Selector = {}
  for (const [dim, i] of Object.entries(indices)) {
    selector[dim] = { selected: i, type: 'index' }
  }
  return selector
}

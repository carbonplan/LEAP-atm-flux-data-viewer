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
  defaultClim,
  defaultColormap,
  isLabVar,
  isSpatial,
  renderable,
} from '@/lib/config'

export type Selector = Record<string, { selected: number; type: 'index' }>

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
  status: string
  mapInstance: maplibregl.Map | null
  zarrLayer: ZarrLayer | null
  pointResult: QueryResult | null
  regionResult: QueryResult | null
}

interface AppState {
  // store introspection
  arrays: ArrayMeta[]
  storeReady: boolean
  error: string | null

  // panes[0] is always live; panes[1] renders only in compare mode
  panes: [PaneState, PaneState]
  compare: boolean
  /** Keep the time/month index in step across panes (the Task 2 case). */
  linkTime: boolean
  /** Escape hatch out of the LAB_VARS allowlist. */
  showAll: boolean
  hoverQueryEnabled: boolean
  /** Zone currently drawn on the map, and whose stats are on screen. */
  activeZone: Zone | null

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
  setCompare: (compare: boolean) => void
  setLinkTime: (linkTime: boolean) => void
  setShowAll: (showAll: boolean) => void
  setHoverQueryEnabled: (enabled: boolean) => void
  setActiveZone: (zone: Zone | null) => void
  clearResults: () => void

  /** Fire a query against every live pane, so one click reads both maps. */
  queryPoint: (
    lngLat: [number, number],
    options?: { signal?: AbortSignal },
  ) => Promise<void>
  queryRegion: (geometry: QueryGeometry) => Promise<void>
}

function emptyPane(): PaneState {
  return {
    variable: '',
    clim: [0, 1],
    colormap: 'warm',
    indices: {},
    force: false,
    status: '',
    mapInstance: null,
    zarrLayer: null,
    pointResult: null,
    regionResult: null,
  }
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
    pointResult: null,
    regionResult: null,
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
  const livePanes = (s: AppState) => (s.compare ? [0, 1] : [0])

  return {
    arrays: [],
    storeReady: false,
    error: null,

    panes: [emptyPane(), emptyPane()],
    compare: false,
    linkTime: true,
    showAll: false,
    hoverQueryEnabled: false,
    activeZone: null,

    setArrays: (arrays) => {
      // Prefer a lab variable as the landing view; fall back to anything
      // renderable so the app still works against an unrelated store.
      const renderables = arrays.filter(renderable)
      const first = renderables.find(isLabVar) ?? renderables[0]
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
      const v = get().arrays.find((a) => a.path === path)
      if (!v) return
      patch(pane, derivedFor(v))
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
        return { ...p, ...derivedFor(match) }
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

    setCompare: (compare) => set({ compare }),
    setLinkTime: (linkTime) => set({ linkTime }),
    setShowAll: (showAll) => set({ showAll }),
    setHoverQueryEnabled: (hoverQueryEnabled) => set({ hoverQueryEnabled }),
    setActiveZone: (activeZone) => set({ activeZone }),

    clearResults: () =>
      set((s) => ({
        activeZone: null,
        panes: s.panes.map((p) => ({
          ...p,
          pointResult: null,
          regionResult: null,
        })) as [PaneState, PaneState],
      })),

    queryPoint: async (lngLat, options) => {
      const s = get()
      const geometry: QueryGeometry = { type: 'Point', coordinates: lngLat }
      await Promise.all(
        livePanes(s).map(async (i) => {
          const layer = s.panes[i].zarrLayer
          if (!layer) return
          try {
            const result = await layer.queryData(
              geometry,
              toSelector(s.panes[i].indices),
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
              toSelector(s.panes[i].indices),
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
  }
})

/** Panes with a map on screen: [0] alone, or [0, 1] in compare mode. */
export const usePaneIndices = () =>
  useAppStore((s) => (s.compare ? PANES_BOTH : PANES_ONE))
const PANES_ONE = [0]
const PANES_BOTH = [0, 1]

/** Shape the flat index map into the selector zarr-layer expects. */
export function toSelector(indices: Record<string, number>): Selector {
  const selector: Selector = {}
  for (const [dim, i] of Object.entries(indices)) {
    selector[dim] = { selected: i, type: 'index' }
  }
  return selector
}

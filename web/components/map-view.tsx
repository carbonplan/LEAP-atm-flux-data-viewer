'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Box } from 'theme-ui'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { useThemedColormap } from '@carbonplan/colormaps'
import { chunkMB, MAX_CHUNK_MB } from '@/lib/config'
import { loadGeographicBounds, resolveCrs } from '@/lib/crs'
import { getStore } from '@/lib/icechunk'
import { zoneMaskGeometry, zoneOutlineGeometry } from '@/lib/query'
import { toSelector, useAppStore } from '@/lib/store'
import { loadZarrLayer } from '@/lib/zarr-layer'

// Flatten every landcover fill to LEAP's `hinted` so the data layer carries all
// the color, and keep only coastlines/labels for orientation.
const LAND_LIGHT = '#f2f2f1'
const LAND_DARK = '#1c1c1c'

function basemapTheme(dark: boolean) {
  const LAND = dark ? LAND_DARK : LAND_LIGHT
  return {
    ...namedFlavor(dark ? 'dark' : 'light'),
    background: dark ? '#0a0a0a' : '#ffffff',
    earth: LAND,
    park_a: LAND,
    park_b: LAND,
    wood_a: LAND,
    wood_b: LAND,
    scrub_a: LAND,
    scrub_b: LAND,
    farmland: LAND,
    residential: LAND,
    industrial: LAND,
    landcover: {
      barren: LAND,
      farmland: LAND,
      forest: LAND,
      glacier: LAND,
      grassland: LAND,
      scrub: LAND,
      urban_area: LAND,
    },
    regular: 'Relative Pro Book',
    bold: 'Relative Pro Book',
    italic: 'Relative Pro Book',
  }
}

const GLYPHS =
  'https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/fonts/{fontstack}/{range}.pbf'
const PMTILES =
  'pmtiles://https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/pmtiles/global.pmtiles'

const LAYER_ID = 'ceres-zarr'
// Persistent coastline stroke, kept above the data layer (which is always
// inserted with beforeId: COASTLINE_ID) so land/ocean separation survives
// the opaque data raster.
const COASTLINE_ID = 'ceres-coastline'
function coastlineLayer(dark: boolean): maplibregl.LayerSpecification {
  return {
    id: COASTLINE_ID,
    type: 'line',
    source: 'protomaps',
    'source-layer': 'water',
    paint: { 'line-color': dark ? '#4a4a47' : '#9a9a97', 'line-width': 0.6 },
  }
}

const REGION_SOURCE = 'ceres-region'
const REGION_MASK_ID = 'ceres-region-mask'
const REGION_LINE_ID = 'ceres-region-line'
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

// How long to keep a superseded data layer around if the new one never
// reports finishing, so a wedged fetch can't leave two rasters stacked.
const SWAP_TIMEOUT_MS = 8000

/**
 * The protomaps layer set points `icon-image` at sprite icons (town dots,
 * capital markers, road shields, oneway arrows) and this style ships no
 * sprite sheet, so maplibre warns once per missing image. Place *labels* are
 * what orients a reader here; the dots are noise over a data raster.
 */
function withoutIcons(
  input: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return input.map((layer) => {
    const layout = (layer as { layout?: Record<string, unknown> }).layout
    if (!layout || !('icon-image' in layout)) return layer
    const next = { ...layout }
    delete next['icon-image']
    return { ...layer, layout: next } as maplibregl.LayerSpecification
  })
}

function buildStyle(dark: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    sources: {
      protomaps: {
        type: 'vector',
        url: PMTILES,
        attribution:
          '<a href="https://overturemaps.org/">Overture Maps</a>, <a href="https://protomaps.com">Protomaps</a>, © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: [
      ...withoutIcons(layers('protomaps', basemapTheme(dark), { lang: 'en' })),
      coastlineLayer(dark),
    ],
  }
}

export default function MapView({
  pane,
  globe,
  dark,
}: {
  pane: number
  globe: boolean
  dark: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null)
  const layerIdRef = useRef<string | null>(null)
  // Every data layer this pane has on the map. During a variable switch that
  // is briefly two: the outgoing one stays until the incoming one has painted.
  const layerIdsRef = useRef<string[]>([])
  const loadingRef = useRef(false)
  const pendingIndicesRef = useRef<Record<string, number> | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [regionTick, setRegionTick] = useState(0)
  const isFirstDark = useRef(true)

  const arrays = useAppStore((s) => s.arrays)
  const storeReady = useAppStore((s) => s.storeReady)
  const variable = useAppStore((s) => s.panes[pane].variable)
  const clim = useAppStore((s) => s.panes[pane].clim)
  const colormapName = useAppStore((s) => s.panes[pane].colormap)
  const indices = useAppStore((s) => s.panes[pane].indices)
  const force = useAppStore((s) => s.panes[pane].force)
  const setStatus = useAppStore((s) => s.setStatus)
  const setMapInstance = useAppStore((s) => s.setMapInstance)
  const setZarrLayer = useAppStore((s) => s.setZarrLayer)
  const queryPoint = useAppStore((s) => s.queryPoint)
  const hoverQueryEnabled = useAppStore((s) => s.hoverQueryEnabled)
  const activeZone = useAppStore((s) => s.activeZone)

  const colormap = useThemedColormap(colormapName, { format: 'hex' })

  const current = useMemo(
    () => arrays.find((a) => a.path === variable),
    [arrays, variable],
  )
  const crsInfo = useMemo(
    () => (current ? resolveCrs(current, arrays) : null),
    [current, arrays],
  )
  const oversized = Boolean(current && chunkMB(current) > MAX_CHUNK_MB && !force)

  // Init map once.
  useEffect(() => {
    if (!containerRef.current) return

    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(dark),
      center: [0, 15],
      zoom: 1.4,
    })
    mapRef.current = map
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    )
    map.on('load', () => setMapReady(true))
    setMapInstance(pane, map)

    return () => {
      layerRef.current = null
      layerIdRef.current = null
      layerIdsRef.current = []
      setMapReady(false)
      map.remove()
      mapRef.current = null
      setMapInstance(pane, null)
      setZarrLayer(pane, null)
      maplibregl.removeProtocol('pmtiles')
    }
    // `dark` here is only the style at first mount; later toggles go through
    // the setStyle effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guarded on mapReady: setProjection throws "Style is not done loading" if
  // it lands before the style finishes.
  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.setProjection({ type: globe ? 'globe' : 'mercator' })
  }, [globe, mapReady])

  // Rebuild the basemap style on dark-mode toggle. setStyle discards any
  // runtime-added (non-style-JSON) layers, so drop the stale data-layer refs
  // and bump styleEpoch to make the data-layer effect re-add it.
  useEffect(() => {
    if (isFirstDark.current) {
      isFirstDark.current = false
      return
    }
    const map = mapRef.current
    if (!map) return

    let cancelled = false
    // setStyle against a style that is still loading can't be diffed, so
    // maplibre throws the whole style away and rebuilds it. Wait for idle.
    const apply = () => {
      if (cancelled) return
      map.setStyle(buildStyle(dark))
      map.once('style.load', () => {
        if (cancelled) return
        layerRef.current = null
        layerIdRef.current = null
        layerIdsRef.current = []
        setStyleEpoch((e) => e + 1)
      })
    }

    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)

    return () => {
      cancelled = true
      map.off('idle', apply)
    }
  }, [dark])

  // (Re)create the data layer whenever the variable or its geometry changes.
  useEffect(() => {
    if (!mapReady || !storeReady || !current || !crsInfo?.supported) return
    if (oversized) return

    const map = mapRef.current
    if (!map) return
    let stale = false
    let clickHandler: ((event: maplibregl.MapMouseEvent) => void) | null = null

    let swapTimer: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      try {
        const [{ ZarrLayer }, store] = await Promise.all([
          loadZarrLayer(),
          getStore(),
        ])
        if (stale || !mapRef.current) return

        // Geographic bounds aren't in crsInfo yet — zarr-layer's own
        // coordinate-array auto-detection assumes root-level or bare-name
        // coords, which a nested DataTree group breaks. Read them ourselves.
        const bounds =
          crsInfo.bounds ??
          (await loadGeographicBounds(store, crsInfo.coordPaths))
        if (stale || !mapRef.current) return

        // Keep the old layer on screen until the new one has actually
        // painted. Removing it here (before any chunk has arrived) is what
        // used to flash the basemap through on every variable switch.
        const previousId = layerIdRef.current
        const id = `${LAYER_ID}-${Date.now()}`

        const dropPrevious = () => {
          if (swapTimer) {
            clearTimeout(swapTimer)
            swapTimer = null
          }
          if (!previousId) return
          const m = mapRef.current
          if (m?.getLayer(previousId)) m.removeLayer(previousId)
          layerIdsRef.current = layerIdsRef.current.filter(
            (l) => l !== previousId,
          )
        }

        const layer = new ZarrLayer({
          id,
          store,
          variable: current.path,
          zarrVersion: 3,
          clim,
          colormap,
          opacity: 1,
          selector: toSelector(indices),
          spatialDimensions: crsInfo.spatialDimensions,
          bounds,
          latIsAscending: crsInfo.latIsAscending,
          ...(crsInfo.proj4 ? { proj4: crsInfo.proj4 } : { crs: crsInfo.crs }),
          onLoadingStateChange: (s: {
            loading: boolean
            error?: Error | null
          }) => {
            // A superseded layer can still report; only the current one owns
            // the shared loading/pending state.
            if (layerIdRef.current !== id) return
            loadingRef.current = s.loading
            setStatus(
              pane,
              s.error ? `error: ${s.error.message}` : s.loading ? 'loading…' : '',
            )
            if (s.loading) return
            // First quiet moment for this layer: it has data on screen, so
            // the layer it replaced can go.
            dropPrevious()
            // A selector change that arrived mid-fetch was held back rather
            // than queued behind it; apply the newest one now.
            const pending = pendingIndicesRef.current
            if (pending) {
              pendingIndicesRef.current = null
              layerRef.current?.setSelector?.(toSelector(pending))
            }
          },
        })
        // beforeId puts the new layer above the outgoing one, and it paints
        // opaque, so the swap is invisible.
        map.addLayer(layer, COASTLINE_ID)
        layerRef.current = layer
        layerIdRef.current = id
        layerIdsRef.current = [...layerIdsRef.current, id]
        loadingRef.current = true
        pendingIndicesRef.current = null
        setZarrLayer(pane, layer)
        swapTimer = setTimeout(dropPrevious, SWAP_TIMEOUT_MS)

        // Query every live pane, not just this one: Task 2 and Task 7.2 are
        // both "what are the two fields doing at this same spot".
        clickHandler = (event) => {
          queryPoint([event.lngLat.lng, event.lngLat.lat])
        }
        map.on('click', clickHandler)
      } catch (err) {
        if (!stale) setStatus(pane, `error: ${(err as Error).message}`)
      }
    })()

    return () => {
      stale = true
      if (swapTimer) clearTimeout(swapTimer)
      if (clickHandler) map.off('click', clickHandler)
    }
    // clim/colormap/opacity/indices are applied by the cheap-update effects
    // below rather than by rebuilding the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, storeReady, current?.path, crsInfo?.label, oversized, styleEpoch])

  // Drop the layer when the selected variable is too large to auto-render.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !oversized) return
    layerIdsRef.current.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id)
    })
    layerIdsRef.current = []
    layerRef.current = null
    layerIdRef.current = null
  }, [oversized])

  // Cheap, synchronous updates — no refetch.
  useEffect(() => {
    layerRef.current?.setClim?.(clim)
  }, [clim])
  useEffect(() => {
    layerRef.current?.setColormap?.(colormap)
  }, [colormap])

  // Dimension changes refetch chunks. Rather than pay a flat debounce on every
  // step, apply immediately when nothing is in flight and otherwise hold only
  // the newest value, which the load callback applies once the fetch lands.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    if (loadingRef.current) {
      pendingIndicesRef.current = indices
      return
    }
    pendingIndicesRef.current = null
    layer.setSelector?.(toSelector(indices))
  }, [indices])

  // Draw the selected zone: a translucent mask over everything outside it,
  // plus its edge. Both panes draw the same zone, so A and B agree about what
  // the region readout measured. The camera is left alone on purpose.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // addSource throws while a setStyle is still in flight; come back on idle.
    if (!map.isStyleLoaded()) {
      const retry = () => setRegionTick((t) => t + 1)
      map.once('idle', retry)
      return () => {
        map.off('idle', retry)
      }
    }

    // A global zone has nothing to dim and nothing useful to outline.
    const zone =
      activeZone && !(activeZone.south <= -90 && activeZone.north >= 90)
        ? activeZone
        : null
    const data: GeoJSON.FeatureCollection = zone
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { kind: 'mask' },
              geometry: zoneMaskGeometry(zone),
            },
            {
              type: 'Feature',
              properties: { kind: 'outline' },
              geometry: zoneOutlineGeometry(zone),
            },
          ],
        }
      : EMPTY_FC

    const existing = map.getSource(REGION_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined
    if (existing) {
      existing.setData(data)
      return
    }

    map.addSource(REGION_SOURCE, { type: 'geojson', data })
    // No beforeId: these sit above the data raster and the basemap labels.
    map.addLayer({
      id: REGION_MASK_ID,
      type: 'fill',
      source: REGION_SOURCE,
      filter: ['==', ['get', 'kind'], 'mask'],
      paint: {
        'fill-color': dark ? '#0a0a0a' : '#ffffff',
        'fill-opacity': 0.45,
        'fill-antialias': false,
      },
    })
    map.addLayer({
      id: REGION_LINE_ID,
      type: 'line',
      source: REGION_SOURCE,
      filter: ['==', ['get', 'kind'], 'outline'],
      paint: {
        'line-color': dark ? '#f2f2f1' : '#1b1e23',
        'line-width': 1.5,
      },
    })
  }, [activeZone, mapReady, styleEpoch, dark, regionTick])

  // Hover-to-query: one in-flight point query at a time, aborting the
  // previous request on each new mousemove.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hoverQueryEnabled) return

    const canvas = map.getCanvas()
    const prevCursor = canvas.style.cursor
    canvas.style.cursor = 'crosshair'

    let abortController: AbortController | null = null
    const handler = (event: maplibregl.MapMouseEvent) => {
      abortController?.abort()
      const controller = new AbortController()
      abortController = controller
      queryPoint([event.lngLat.lng, event.lngLat.lat], {
        signal: controller.signal,
      })
    }
    map.on('mousemove', handler)

    return () => {
      abortController?.abort()
      canvas.style.cursor = prevCursor
      map.off('mousemove', handler)
    }
  }, [hoverQueryEnabled, queryPoint])

  return (
    <Box
      ref={containerRef}
      sx={{ position: 'absolute', inset: 0, bg: 'background' }}
    />
  )
}

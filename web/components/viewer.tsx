'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Checkbox, Flex, Label as UILabel, useColorMode } from 'theme-ui'
import type maplibregl from 'maplibre-gl'
import { arraysFromStore } from '@/lib/store-schema'
import { describeStoreError, getStore } from '@/lib/icechunk'
import { useAppStore } from '@/lib/store'
import { loadZarrLayer } from '@/lib/zarr-layer'
import MapView from '@/components/map-view'
import Sidebar from '@/components/sidebar'
import Overlay from '@/components/overlay'

const toggleSx = {
  width: 'auto',
  flexShrink: 0,
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  textTransform: 'uppercase',
  color: 'secondary',
  alignItems: 'center',
  cursor: 'pointer',
}

/**
 * Keep two panes looking at the same place. Without this, a side-by-side
 * comparison is only as good as the user's ability to pan both maps by hand.
 */
function useCameraSync(
  a: maplibregl.Map | null,
  b: maplibregl.Map | null,
  enabled: boolean,
) {
  const syncing = useRef(false)
  useEffect(() => {
    if (!enabled || !a || !b) return

    const mirror = (from: maplibregl.Map, to: maplibregl.Map) => () => {
      if (syncing.current) return
      syncing.current = true
      to.jumpTo({
        center: from.getCenter(),
        zoom: from.getZoom(),
        bearing: from.getBearing(),
        pitch: from.getPitch(),
      })
      syncing.current = false
    }

    const aToB = mirror(a, b)
    const bToA = mirror(b, a)
    a.on('move', aToB)
    b.on('move', bToA)
    aToB()

    return () => {
      a.off('move', aToB)
      b.off('move', bToA)
    }
  }, [a, b, enabled])
}

export default function Viewer() {
  const [globe, setGlobe] = useState(true)
  const [dark, setDark] = useState(true)
  const [, setColorMode] = useColorMode()

  useEffect(() => {
    setColorMode(dark ? 'dark' : 'light')
  }, [dark, setColorMode])

  const setArrays = useAppStore((s) => s.setArrays)
  const setStoreReady = useAppStore((s) => s.setStoreReady)
  const setError = useAppStore((s) => s.setError)
  const setStatus = useAppStore((s) => s.setStatus)
  const compare = useAppStore((s) => s.mode === 'compare')
  const mapA = useAppStore((s) => s.panes[0].mapInstance)
  const mapB = useAppStore((s) => s.panes[1].mapInstance)

  useCameraSync(mapA, mapB, compare)

  useEffect(() => {
    let cancelled = false
    setStatus(0, 'reading store metadata…')
    // Warm the layer bundle alongside the metadata read, so switching on
    // compare later doesn't pay for the import.
    loadZarrLayer().catch(() => {})
    getStore()
      .then((store) => {
        if (cancelled) return
        setArrays(arraysFromStore(store))
        setStoreReady(true)
        setStatus(0, '')
      })
      .catch((err) => {
        if (cancelled) return
        setError(describeStoreError(err))
        setStatus(0, '')
      })
    return () => {
      cancelled = true
    }
  }, [setArrays, setStoreReady, setError, setStatus])

  return (
    <Flex sx={{ position: 'fixed', inset: 0 }}>
      <Sidebar />
      <Flex sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <MapView pane={0} globe={globe} dark={dark} />
          <Overlay pane={0} />
        </Box>
        {compare && (
          <Box
            sx={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              borderLeft: '1px solid',
              borderColor: 'muted',
            }}
          >
            <MapView pane={1} globe={globe} dark={dark} />
            <Overlay pane={1} />
          </Box>
        )}

        {/* Display-only toggles, kept out of the control flow in the sidebar. */}
        <Flex
          sx={{
            position: 'absolute',
            top: 3,
            right: 3,
            gap: 3,
            bg: 'background',
            border: '1px solid',
            borderColor: 'muted',
            px: 2,
            py: 1,
            zIndex: 1,
          }}
        >
          <UILabel sx={toggleSx}>
            <Checkbox
              checked={globe}
              onChange={(e) => setGlobe(e.target.checked)}
              sx={{ color: 'text', mr: 1 }}
            />
            Globe
          </UILabel>
          <UILabel sx={toggleSx}>
            <Checkbox
              checked={dark}
              onChange={(e) => setDark(e.target.checked)}
              sx={{ color: 'text', mr: 1 }}
            />
            Dark
          </UILabel>
        </Flex>
      </Flex>
    </Flex>
  )
}

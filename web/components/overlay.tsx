'use client'

import { useMemo } from 'react'
import { Box, Flex, Text } from 'theme-ui'
import { chunkMB, formatValue, labelOf, MAX_CHUNK_MB, units } from '@/lib/config'
import { useOrientedColormap } from '@/lib/colormap'
import { useAppStore } from '@/lib/store'

/** Colorbar, variable caption and status readout, floating over one map pane. */
export default function Overlay({ pane }: { pane: number }) {
  const status = useAppStore((s) => s.panes[pane].status)
  const clim = useAppStore((s) => s.panes[pane].clim)
  const colormapName = useAppStore((s) => s.panes[pane].colormap)
  const force = useAppStore((s) => s.panes[pane].force)
  const storeReady = useAppStore((s) => s.storeReady)
  const arrays = useAppStore((s) => s.arrays)
  const compare = useAppStore((s) => s.mode === 'compare')
  const variable = useAppStore((s) => s.panes[pane].variable)
  const diffWith = useAppStore((s) => s.panes[pane].diffWith)
  const current = useMemo(
    () => arrays.find((a) => a.path === variable),
    [arrays, variable],
  )

  const other = useMemo(
    () => arrays.find((a) => a.path === diffWith),
    [arrays, diffWith],
  )

  const swatch = useOrientedColormap(colormapName)
  const mb = current ? chunkMB(current) : 0
  const oversized = Boolean(storeReady && current && mb > MAX_CHUNK_MB && !force)
  const u = current ? units(current) : ''

  return (
    <>
      {oversized && (
        <Flex
          sx={{
            position: 'absolute',
            inset: 0,
            flexDirection: 'column',
            gap: 3,
            alignItems: 'center',
            justifyContent: 'center',
            bg: 'background',
            px: 4,
            textAlign: 'center',
          }}
        >
          <Text
            sx={{
              fontFamily: 'mono',
              fontSize: 1,
              letterSpacing: 'mono',
              color: 'orange',
            }}
          >
            ~{mb.toFixed(0)} MB per chunk — too large to render
          </Text>
          <Text
            sx={{
              fontFamily: 'mono',
              fontSize: 0,
              letterSpacing: 'mono',
              color: 'secondary',
              maxWidth: '420px',
              lineHeight: 1.5,
            }}
          >
            zarr-layer fetches whole chunks, so this variable would download in
            full before painting. Rechunking the store along time is the fix.
          </Text>
        </Flex>
      )}

      {!oversized && current && (
        <Box
          sx={{
            position: 'absolute',
            left: 3,
            bottom: 3,
            bg: 'background',
            border: '1px solid',
            borderColor: 'muted',
            px: 3,
            py: 2,
            minWidth: '220px',
          }}
        >
          {(compare || other) && (
            <Box
              sx={{
                fontFamily: 'mono',
                fontSize: 0,
                letterSpacing: 'mono',
                color: 'text',
                lineHeight: 1.3,
                maxWidth: '320px',
                mb: 1,
              }}
            >
              {other
                ? `${labelOf(current)} \u2212 ${labelOf(other)}`
                : `${pane === 0 ? 'A' : 'B'} \u00b7 ${labelOf(current)}`}
            </Box>
          )}
          <Flex sx={{ height: '8px', mb: 1 }}>
            {swatch.map((hex, i) => (
              <Box key={i} sx={{ flex: 1, bg: hex }} />
            ))}
          </Flex>
          <Flex
            sx={{
              justifyContent: 'space-between',
              fontFamily: 'mono',
              fontSize: 0,
              letterSpacing: 'mono',
              color: 'secondary',
            }}
          >
            <Box>{formatValue(clim[0])}</Box>
            <Box sx={{ color: 'text' }}>{u}</Box>
            <Box>{formatValue(clim[1])}</Box>
          </Flex>
        </Box>
      )}

      {status && (
        <Box
          sx={{
            position: 'absolute',
            top: 3,
            left: 3,
            bg: 'background',
            border: '1px solid',
            borderColor: 'muted',
            px: 2,
            py: 1,
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            color: 'secondary',
          }}
        >
          {status}
        </Box>
      )}
    </>
  )
}

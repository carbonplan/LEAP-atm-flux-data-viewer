'use client'

import { useMemo, useState } from 'react'
import { Box, Button, Checkbox, Flex, Label as UILabel, Text } from 'theme-ui'
import { formatValue, units } from '@/lib/config'
import {
  boundsToGeometry,
  getPointValue,
  getRegionStats,
  ZONES,
  zoneGeometry,
  type Zone,
} from '@/lib/query'
import { useAppStore } from '@/lib/store'
import Label from '@/components/controls/label'

const readoutSx = {
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  color: 'text',
}

const captionSx = {
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  color: 'secondary',
}

const buttonSx = {
  bg: 'transparent',
  color: 'text',
  border: '1px solid',
  borderColor: 'muted',
  borderRadius: 0,
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  textTransform: 'uppercase',
  px: 2,
  py: 1,
  cursor: 'pointer',
  '&:hover': { borderColor: 'text' },
  '&:disabled': { cursor: 'default', opacity: 0.5 },
}

/**
 * Point and region value readouts, shared across panes: one click or one zone
 * button reads every map on screen, which is what the comparison tasks want.
 */
export default function QueryPanel() {
  const arrays = useAppStore((s) => s.arrays)
  const panes = useAppStore((s) => s.panes)
  const compare = useAppStore((s) => s.compare)
  const queryRegion = useAppStore((s) => s.queryRegion)
  const clearResults = useAppStore((s) => s.clearResults)
  const hoverQueryEnabled = useAppStore((s) => s.hoverQueryEnabled)
  const setHoverQueryEnabled = useAppStore((s) => s.setHoverQueryEnabled)
  const setPointResult = useAppStore((s) => s.setPointResult)
  const [queryInFlight, setQueryInFlight] = useState(false)
  // In the store rather than local state: map-view draws the same zone.
  const activeZone = useAppStore((s) => s.activeZone)
  const setActiveZone = useAppStore((s) => s.setActiveZone)

  const live = compare ? [0, 1] : [0]
  const rows = useMemo(
    () =>
      live.map((i) => {
        const pane = panes[i]
        const variable = arrays.find((a) => a.path === pane.variable)
        const fillValue = pane.zarrLayer?.fillValue ?? Number.NaN
        return {
          i,
          variable,
          unit: variable ? units(variable) : '',
          point: variable
            ? getPointValue(pane.pointResult, variable.path, fillValue)
            : null,
          region: variable
            ? getRegionStats(pane.regionResult, variable.path, fillValue)
            : null,
        }
      }),
    // `live` is derived from `compare`, so it does not need its own entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panes, arrays, compare],
  )

  const run = async (zone: Zone | null, geometry: Parameters<typeof queryRegion>[0]) => {
    if (queryInFlight) return
    setQueryInFlight(true)
    setActiveZone(zone)
    try {
      await queryRegion(geometry)
    } finally {
      setQueryInFlight(false)
    }
  }

  const handleZone = (zone: Zone) => run(zone, zoneGeometry(zone))

  const handleViewport = () => {
    const map = panes[0].mapInstance
    const bounds = map?.getBounds()
    if (!bounds) return
    return run(null, boundsToGeometry(bounds))
  }

  if (rows.every((r) => !r.variable)) return null

  const hasPoint = rows.some((r) => r.point !== null)

  const paneName = (i: number) => (compare ? (i === 0 ? 'A · ' : 'B · ') : '')

  return (
    <Box sx={{ mb: 4 }}>
      <Flex sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label>Point</Label>
        <UILabel
          sx={{
            width: 'auto',
            flexShrink: 0,
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            textTransform: 'uppercase',
            color: 'secondary',
            alignItems: 'center',
            cursor: 'pointer',
            mb: 2,
          }}
        >
          <Checkbox
            checked={hoverQueryEnabled}
            onChange={(e) => {
              setHoverQueryEnabled(e.target.checked)
              // Turning hover off drops the readout with it; a map click
              // brings it back.
              if (!e.target.checked) rows.forEach((r) => setPointResult(r.i, null))
            }}
            sx={{ color: 'text', mr: 1 }}
          />
          Hover
        </UILabel>
      </Flex>
      {/* Only worth the space once there is a value to show, or while hover
          is arming every mousemove with one. */}
      {(hoverQueryEnabled || hasPoint) &&
        rows.map((r) => (
          <Flex key={r.i} sx={{ justifyContent: 'space-between', mb: 1 }}>
            <Box sx={captionSx}>
              {paneName(r.i)}
              {r.variable?.name ?? '—'}
            </Box>
            <Box sx={readoutSx}>
              {r.point !== null
                ? `${formatValue(r.point)} ${r.unit}`.trim()
                : '—'}
            </Box>
          </Flex>
        ))}

      <Box sx={{ mt: 4 }}>
        <Label value={activeZone?.label ?? undefined}>Region</Label>
        {/* Fixed zones, not the viewport: Lab 1 Task 4c/4d want per-hemisphere
            numbers that reproduce between lab partners. */}
        <Flex sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {ZONES.map((zone) => (
            <Button
              key={zone.label}
              onClick={() => handleZone(zone)}
              disabled={queryInFlight}
              sx={{
                ...buttonSx,
                borderColor: activeZone?.label === zone.label ? 'text' : 'muted',
              }}
            >
              {zone.label}
            </Button>
          ))}
          <Button
            onClick={handleViewport}
            disabled={queryInFlight}
            sx={buttonSx}
          >
            Viewport
          </Button>
        </Flex>

        {rows.map((r) => (
          <Box key={r.i} sx={{ mb: 2 }}>
            <Box sx={captionSx}>
              {paneName(r.i)}
              {r.variable?.name ?? '—'}
            </Box>
            {r.region ? (
              <Box sx={readoutSx}>
                <Flex sx={{ justifyContent: 'space-between' }}>
                  <Box sx={captionSx}>
                    {r.region.weighted ? 'area-wtd mean' : 'mean (unweighted)'}
                  </Box>
                  <Box>{`${formatValue(r.region.mean)} ${r.unit}`.trim()}</Box>
                </Flex>
                <Flex sx={{ justifyContent: 'space-between' }}>
                  <Box sx={captionSx}>min</Box>
                  <Box>{`${formatValue(r.region.min)} ${r.unit}`.trim()}</Box>
                </Flex>
                <Flex sx={{ justifyContent: 'space-between' }}>
                  <Box sx={captionSx}>max</Box>
                  <Box>{`${formatValue(r.region.max)} ${r.unit}`.trim()}</Box>
                </Flex>
              </Box>
            ) : (
              <Box sx={readoutSx}>{queryInFlight ? 'querying…' : '—'}</Box>
            )}
          </Box>
        ))}

        {rows.some((r) => r.point !== null || r.region) && (
          <Button
            onClick={clearResults}
            sx={{ ...buttonSx, mt: 1 }}
          >
            Clear
          </Button>
        )}
      </Box>

      <Text sx={{ ...captionSx, display: 'block', mt: 2, lineHeight: 1.5 }}>
        Region means are weighted by cos(latitude); min and max are not.
      </Text>
    </Box>
  )
}

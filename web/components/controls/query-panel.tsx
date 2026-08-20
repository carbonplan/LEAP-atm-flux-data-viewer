'use client'

import { useMemo, useState } from 'react'
import type { QueryGeometry } from '@carbonplan/zarr-layer'
import { Box, Button, Checkbox, Flex, Label as UILabel, Text } from 'theme-ui'
import { formatValue, labelOf, units } from '@/lib/config'
import {
  boundsToGeometry,
  getPointValue,
  getRegionStats,
  ZONES,
  zoneBounds,
  zoneGeometry,
  type Zone,
} from '@/lib/query'
import { useAppStore } from '@/lib/store'
import { valueKey } from '@/lib/diff'
import { seriesDim, seriesLength } from '@/lib/series'
import Label from '@/components/controls/label'
import SeriesChart from '@/components/controls/series-chart'

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
  '&:hover': { borderColor: 'primary' },
  // These are plain <button>s with no ring of their own; without this a
  // keyboard user cannot tell which zone they are on.
  '&:focus-visible': { outline: 'none', borderColor: 'primary', color: 'primary' },
  '&:disabled': { cursor: 'default', opacity: 0.5 },
}

/**
 * Point and region value readouts, shared across panes: one click or one zone
 * button reads every map on screen, which is what the comparison tasks want.
 */
export default function QueryPanel() {
  const arrays = useAppStore((s) => s.arrays)
  const panes = useAppStore((s) => s.panes)
  const compare = useAppStore((s) => s.mode === 'compare')
  const queryRegion = useAppStore((s) => s.queryRegion)
  const clearResults = useAppStore((s) => s.clearResults)
  const hoverQueryEnabled = useAppStore((s) => s.hoverQueryEnabled)
  const setHoverQueryEnabled = useAppStore((s) => s.setHoverQueryEnabled)
  const setPointResult = useAppStore((s) => s.setPointResult)
  const [queryInFlight, setQueryInFlight] = useState(false)
  const querySeries = useAppStore((s) => s.querySeries)
  const clearSeries = useAppStore((s) => s.clearSeries)
  const seriesLoading = useAppStore((s) => s.seriesLoading)
  const seriesLabel = useAppStore((s) => s.seriesLabel)
  const lastPoint = useAppStore((s) => s.lastPoint)
  const diffMode = useAppStore((s) => s.mode === 'diff')
  const zeroAnchored = useAppStore((s) => s.zeroAnchored)
  const setZeroAnchored = useAppStore((s) => s.setZeroAnchored)
  // The geometry the region readout came from, so a series can re-run it over
  // the whole axis without the reader re-picking the region.
  const [regionGeometry, setRegionGeometry] = useState<QueryGeometry | null>(
    null,
  )
  const [regionLabel, setRegionLabel] = useState<string>('')
  // In the store rather than local state: map-view draws the same zone.
  const activeZone = useAppStore((s) => s.activeZone)
  const setActiveZone = useAppStore((s) => s.setActiveZone)

  const live = compare ? [0, 1] : [0]
  const rows = useMemo(
    () =>
      live.map((i) => {
        const pane = panes[i]
        const variable = arrays.find((a) => a.path === pane.variable)
        const other = arrays.find((a) => a.path === pane.diffWith)
        const fillValue = pane.zarrLayer?.fillValue ?? Number.NaN
        // A difference is filed under its own key, not under A's path.
        const key = valueKey(pane)
        return {
          i,
          variable,
          // Units are A's; the subtraction is unit-preserving by construction.
          unit: variable ? units(variable) : '',
          name: variable
            ? other
              ? `${labelOf(variable)} \u2212 ${labelOf(other)}`
              : labelOf(variable)
            : '—',
          point: variable
            ? getPointValue(pane.pointResult, key, fillValue)
            : null,
          region: variable
            ? getRegionStats(pane.regionResult, key, fillValue)
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
    setRegionGeometry(geometry)
    setRegionLabel(zone?.label ?? 'Viewport')
    try {
      await queryRegion(geometry)
    } finally {
      setQueryInFlight(false)
    }
  }

  // Camera is driven off pane 0 only: the panes are camera-synced (see
  // viewer.tsx), so moving one moves both.
  const mapInstance = panes[0].mapInstance

  const handleZone = (zone: Zone) => {
    if (mapInstance) {
      mapInstance.fitBounds(
        zoneBounds(zone, mapInstance.getCenter().lng),
        {
          // Left padding clears the sidebar so the fitted zone isn't half
          // hidden under it.
          padding: { top: 60, bottom: 60, left: 400, right: 60 },
          duration: 800,
          // fitBounds otherwise skips the animation under prefers-reduced-motion,
          // which reads as an unexplained jump cut rather than a pan.
          essential: true,
        },
      )
    }
    run(zone, zoneGeometry(zone))
  }

  const handleSeries = (geometry: QueryGeometry, label: string) => {
    if (seriesLoading) return
    querySeries(geometry, label)
  }

  const handleViewport = () => {
    const map = panes[0].mapInstance
    const bounds = map?.getBounds()
    if (!bounds) return
    return run(null, boundsToGeometry(bounds))
  }

  if (rows.every((r) => !r.variable)) return null

  // Pane 0 decides whether a series is offered at all; in compare mode both
  // panes sit in the same group and share the axis.
  const seriesDim0 = seriesDim(rows[0].variable)
  const seriesLength0 =
    rows[0].variable && seriesDim0
      ? seriesLength(rows[0].variable, seriesDim0)
      : 0

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
              {r.name}
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
                borderColor:
                  activeZone?.label === zone.label ? 'primary' : 'muted',
                color: activeZone?.label === zone.label ? 'primary' : 'text',
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
              {r.name}
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

      {seriesDim0 && seriesLength0 > 1 && (
        <Box sx={{ mt: 4 }}>
          <Label value={seriesLabel ?? undefined}>Series</Label>
          {/* The chart fits its y-axis to the data by default, which makes a
              small wobble look dramatic. This re-anchors it at zero. */}
          {!diffMode && (
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
                checked={zeroAnchored}
                onChange={(e) => setZeroAnchored(e.target.checked)}
                sx={{ color: 'text', mr: 1 }}
              />
              Y axis from zero
            </UILabel>
          )}
          {diffMode ? (
            <Text sx={{ ...captionSx, display: 'block', lineHeight: 1.5 }}>
              A difference is computed one step at a time, so it has no series.
              Leave diff mode to chart either variable on its own.
            </Text>
          ) : (
            <>
              <Flex sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <Button
                  onClick={() =>
                    regionGeometry && handleSeries(regionGeometry, regionLabel)
                  }
                  disabled={!regionGeometry || seriesLoading}
                  sx={buttonSx}
                >
                  Over region
                </Button>
                <Button
                  onClick={() =>
                    lastPoint &&
                    handleSeries(
                      { type: 'Point', coordinates: lastPoint },
                      `${lastPoint[1].toFixed(1)}, ${lastPoint[0].toFixed(1)}`,
                    )
                  }
                  disabled={!lastPoint || seriesLoading}
                  sx={buttonSx}
                >
                  At point
                </Button>
                {seriesLabel && !seriesLoading && (
                  <Button onClick={clearSeries} sx={buttonSx}>
                    Clear
                  </Button>
                )}
              </Flex>

              {seriesLoading ? (
                <Box sx={readoutSx}>{`reading ${seriesLength0} steps…`}</Box>
              ) : (
                <SeriesChart />
              )}

              <Text
                sx={{ ...captionSx, display: 'block', mt: 2, lineHeight: 1.5 }}
              >
                {seriesLabel
                  ? 'Drag across the chart to move the map to that step.'
                  : `Pick a region or click the map first. Each step is a separate
                     read, so ${seriesLength0} of them takes a while the first time.`}
              </Text>
            </>
          )}
        </Box>
      )}

      <Text sx={{ ...captionSx, display: 'block', mt: 2, lineHeight: 1.5 }}>
        Region means are weighted by cos(latitude); min and max are not.
      </Text>
    </Box>
  )
}

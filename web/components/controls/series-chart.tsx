'use client'

import { useMemo, useRef } from 'react'
import { Box, Flex } from 'theme-ui'
import { formatValue, labelOf, units } from '@/lib/config'
import { valueKey } from '@/lib/diff'
import { getSeries, seriesDim, seriesLength } from '@/lib/series'
import { useAppStore } from '@/lib/store'
import { formatTimeIndex } from '@/lib/time'

const W = 300
const H = 110

const captionSx = {
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  color: 'secondary',
}

/**
 * One pane's region series as an inline SVG line.
 *
 * Each pane gets its own chart rather than sharing axes: in compare mode the
 * two panes can hold different quantities (albedo vs W m-2), and one shared
 * y-axis across mismatched units would be a lie.
 */
function PaneChart({ pane }: { pane: number }) {
  const arrays = useAppStore((s) => s.arrays)
  const paneState = useAppStore((s) => s.panes[pane])
  const setIndex = useAppStore((s) => s.setIndex)
  const compare = useAppStore((s) => s.mode === 'compare')
  const zeroAnchored = useAppStore((s) => s.zeroAnchored)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const variable = arrays.find((a) => a.path === paneState.variable)
  const dim = seriesDim(variable)
  const length = variable && dim ? seriesLength(variable, dim) : 0

  const points = useMemo(() => {
    if (!variable || !dim) return []
    return getSeries(
      paneState.seriesResult,
      valueKey(paneState),
      paneState.zarrLayer?.fillValue ?? Number.NaN,
      length,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneState.seriesResult, paneState.variable, paneState.diffWith, length])

  if (!variable || !dim || points.length < 2) return null

  const values = points.map((p) => p.mean)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  // Fitting the domain to the data makes a 66→68% wobble fill the box, which
  // reads as a collapse. `zeroAnchored` pulls the domain back to zero so the
  // variation is seen against the size of the quantity.
  const domainLo = zeroAnchored ? Math.min(0, lo) : lo
  const domainHi = zeroAnchored ? Math.max(0, hi) : hi
  // A flat series would divide by zero; give it a nominal band instead.
  const pad = (domainHi - domainLo || Math.abs(domainHi) || 1) * 0.08
  const yMin = domainLo - pad
  const yMax = domainHi + pad

  const x = (i: number) => (length > 1 ? (i / (length - 1)) * W : 0)
  const y = (v: number) => H - ((v - yMin) / (yMax - yMin)) * H

  const path = points
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.index).toFixed(2)},${y(p.mean).toFixed(2)}`)
    .join(' ')

  const current = paneState.indices[dim] ?? 0
  const currentPoint = points.find((p) => p.index === current)
  const u = units(variable)
  const label = (i: number) =>
    formatTimeIndex(dim, i, arrays, variable.group) ?? String(i)

  // Drag along the chart to scrub the map to that index.
  const scrub = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const frac = (event.clientX - rect.left) / rect.width
    const i = Math.round(Math.max(0, Math.min(1, frac)) * (length - 1))
    setIndex(pane, dim, i)
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Flex sx={{ justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Box
          sx={{
            ...captionSx,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {compare ? (pane === 0 ? 'A · ' : 'B · ') : ''}
          {labelOf(variable)}
        </Box>
        <Box sx={{ ...captionSx, color: 'text', flexShrink: 0 }}>
          {currentPoint
            ? `${formatValue(currentPoint.mean)} ${u}`.trim()
            : '—'}
        </Box>
      </Flex>

      {/* Plain <svg> inside a themed Box: `currentColor` picks up the Box's
          color, which keeps the strokes on the theme without theme-ui having
          to type every SVG attribute. */}
      <Box
        sx={{
          color: 'text',
          border: '1px solid',
          borderColor: 'muted',
          lineHeight: 0,
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio='none'
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrub(e)
          }}
          style={{
            display: 'block',
            width: '100%',
            height: '110px',
            cursor: 'col-resize',
            touchAction: 'none',
          }}
        >
          {/* Zero line, only where the series actually crosses it. */}
          {yMin < 0 && yMax > 0 && (
            <line
              x1={0}
              x2={W}
              y1={y(0)}
              y2={y(0)}
              stroke='currentColor'
              strokeOpacity={0.3}
              strokeDasharray='3 3'
              vectorEffect='non-scaling-stroke'
            />
          )}
          {/* Where the map currently sits along the axis. */}
          <line
            x1={x(current)}
            x2={x(current)}
            y1={0}
            y2={H}
            stroke='currentColor'
            strokeOpacity={0.45}
            vectorEffect='non-scaling-stroke'
          />
          <path
            d={path}
            fill='none'
            stroke='currentColor'
            strokeWidth={1.5}
            vectorEffect='non-scaling-stroke'
          />
          {currentPoint && (
            <circle
              cx={x(currentPoint.index)}
              cy={y(currentPoint.mean)}
              r={3}
              fill='currentColor'
              vectorEffect='non-scaling-stroke'
            />
          )}
        </svg>
      </Box>

      {/* Only the time axis sits under the chart. The y range used to live in
          an identical row directly above this one, where it read as a second
          x-axis; it is now named explicitly below. */}
      <Flex sx={{ justifyContent: 'space-between', mt: 1 }}>
        <Box sx={captionSx}>{label(0)}</Box>
        <Box sx={captionSx}>{label(Math.floor((length - 1) / 2))}</Box>
        <Box sx={captionSx}>{label(length - 1)}</Box>
      </Flex>
      <Box sx={{ ...captionSx, mt: 1 }}>
        {`y: ${formatValue(yMin)} to ${formatValue(yMax)} ${u}`.trim()}
        {zeroAnchored ? '' : ' (fitted)'}
      </Box>
    </Box>
  )
}

/** Every live pane's series, or nothing until one has been run. */
export default function SeriesChart() {
  const compare = useAppStore((s) => s.mode === 'compare')
  const panes = compare ? [0, 1] : [0]
  return (
    <>
      {panes.map((i) => (
        <PaneChart key={i} pane={i} />
      ))}
    </>
  )
}

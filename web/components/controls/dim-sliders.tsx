'use client'

import { useMemo } from 'react'
import { Box, Checkbox, Flex, Label as UILabel, Slider } from 'theme-ui'
import { isSpatial } from '@/lib/config'
import { formatTimeIndex } from '@/lib/time'
import { useAppStore } from '@/lib/store'
import Label from '@/components/controls/label'

/**
 * One slider per non-spatial dimension of pane 0's variable. For CERES that is
 * `time` (monthly steps), or `month`/`season`/`year` in the climatology groups.
 *
 * In compare mode the index is mirrored onto the other pane by default — Lab 1
 * Task 2 compares two variables in the *same* month — with an unlink escape
 * hatch for month-to-month comparisons of a single field (Task 1).
 */
export default function DimSliders() {
  const arrays = useAppStore((s) => s.arrays)
  const variable = useAppStore((s) => s.panes[0].variable)
  const indices = useAppStore((s) => s.panes[0].indices)
  const setIndex = useAppStore((s) => s.setIndex)
  const compare = useAppStore((s) => s.mode === 'compare')
  const linkTime = useAppStore((s) => s.linkTime)
  const setLinkTime = useAppStore((s) => s.setLinkTime)
  const paneB = useAppStore((s) => s.panes[1])
  const current = useMemo(
    () => arrays.find((a) => a.path === variable),
    [arrays, variable],
  )
  const variableB = useMemo(
    () => arrays.find((a) => a.path === paneB.variable),
    [arrays, paneB.variable],
  )

  if (!current) return null
  const extraDims = current.dims.filter((d) => !isSpatial(d))
  if (extraDims.length === 0) return null

  return (
    <>
      {compare && (
        <Flex sx={{ mb: 3 }}>
          <UILabel
            sx={{
              width: 'auto',
              fontFamily: 'mono',
              fontSize: 0,
              letterSpacing: 'mono',
              textTransform: 'uppercase',
              color: 'secondary',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <Checkbox
              checked={linkTime}
              onChange={(e) => setLinkTime(e.target.checked)}
              sx={{ color: 'text', mr: 1 }}
            />
            Same time in both maps
          </UILabel>
        </Flex>
      )}

      {extraDims.map((dim) => {
        const size = current.shape[current.dims.indexOf(dim)] ?? 1
        const index = indices[dim] ?? 0
        const label = formatTimeIndex(dim, index, arrays, current.group)
        return (
          <Box key={dim} sx={{ mb: 4 }}>
            <Label value={label ?? `${index} / ${size - 1}`}>
              {compare && !linkTime ? `${dim} · map A` : dim}
            </Label>
            <Slider
              min={0}
              max={Math.max(0, size - 1)}
              step={1}
              value={index}
              onChange={(e) => setIndex(0, dim, Number(e.target.value))}
              sx={{ color: 'primary' }}
            />
          </Box>
        )
      })}

      {/* Unlinked: map B gets its own sliders, over its own dimensions. */}
      {compare &&
        !linkTime &&
        variableB &&
        variableB.dims
          .filter((d) => !isSpatial(d))
          .map((dim) => {
            const size = variableB.shape[variableB.dims.indexOf(dim)] ?? 1
            const index = paneB.indices[dim] ?? 0
            const label = formatTimeIndex(dim, index, arrays, variableB.group)
            return (
              <Box key={`b-${dim}`} sx={{ mb: 4 }}>
                <Label value={label ?? `${index} / ${size - 1}`}>
                  {dim} · map B
                </Label>
                <Slider
                  min={0}
                  max={Math.max(0, size - 1)}
                  step={1}
                  value={index}
                  onChange={(e) => setIndex(1, dim, Number(e.target.value))}
                  sx={{ color: 'primary' }}
                />
              </Box>
            )
          })}
    </>
  )
}

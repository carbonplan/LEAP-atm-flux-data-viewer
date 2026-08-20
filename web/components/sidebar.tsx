'use client'

import { useState } from 'react'
import { Box, Checkbox, Flex, Label as UILabel, Radio, Text } from 'theme-ui'
import Image from 'next/image'
import { describeOf, isLabVar, labelOf, units } from '@/lib/config'
import { diffCandidates, useAppStore, type ViewMode } from '@/lib/store'
import GroupSelect from '@/components/controls/group-select'
import VariableSelect from '@/components/controls/variable-select'
import ColormapSelect from '@/components/controls/colormap-select'
import ClimControl from '@/components/controls/clim-control'
import DimSliders from '@/components/controls/dim-sliders'
import QueryPanel from '@/components/controls/query-panel'
import Dropdown from '@/components/controls/dropdown'
import Label from '@/components/controls/label'

const Divider = () => (
  <Box sx={{ borderTop: '1px solid', borderColor: 'muted', mb: 4 }} />
)

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

const MODES: Array<[ViewMode, string]> = [
  ['single', 'Single'],
  ['compare', 'Compare'],
  ['diff', 'Difference'],
]

/**
 * Single / Compare / Difference. Difference is only offered when the current
 * variable has a partner in the same units — subtracting albedo from W m-2
 * would produce a map of nothing.
 */
function ModeSelect() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const diffable = useAppStore((s) => {
    const a = s.arrays.find((v) => v.path === s.panes[0].variable)
    return a ? diffCandidates(s.arrays, a).length > 0 : false
  })

  return (
    <Flex sx={{ mb: 4, gap: 3 }}>
      {MODES.map(([value, label]) => {
        const disabled = value === 'diff' && !diffable
        return (
          <UILabel
            key={value}
            title={
              disabled
                ? 'No other variable in this dataset shares these units'
                : undefined
            }
            sx={{
              ...toggleSx,
              color: mode === value ? 'text' : 'secondary',
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <Radio
              name='view-mode'
              checked={mode === value}
              disabled={disabled}
              onChange={() => setMode(value)}
              sx={{ color: 'text', mr: 1 }}
            />
            {label}
          </UILabel>
        )
      })}
    </Flex>
  )
}

/** The subtrahend picker, shown under Map A's controls in difference mode. */
function DiffControls() {
  const arrays = useAppStore((s) => s.arrays)
  const variable = useAppStore((s) => s.panes[0].variable)
  const diffWith = useAppStore((s) => s.panes[0].diffWith)
  const setDiffWith = useAppStore((s) => s.setDiffWith)
  const showAll = useAppStore((s) => s.showAll)

  const a = arrays.find((v) => v.path === variable)
  if (!a) return null
  // Same allowlist as the A picker, but never hide whatever is selected.
  const candidates = diffCandidates(arrays, a).filter(
    (v) => showAll || isLabVar(v) || v.path === diffWith,
  )

  return (
    <Box sx={{ mb: 2 }}>
      <Label value={units(a) || undefined}>minus</Label>
      <Dropdown
        value={diffWith ?? ''}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          setDiffWith(e.target.value || null)
        }
      >
        {candidates.map((v) => (
          <option key={v.path} value={v.path} title={describeOf(v)}>
            {labelOf(v)}
          </option>
        ))}
      </Dropdown>
    </Box>
  )
}

/** Variable + color controls for one map. Repeated per pane in compare mode. */
function PaneControls({ pane, advanced }: { pane: number; advanced: boolean }) {
  const compare = useAppStore((s) => s.mode === 'compare')
  return (
    <Box sx={{ mb: 2 }}>
      {compare && (
        <Text
          sx={{
            display: 'block',
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            textTransform: 'uppercase',
            color: 'text',
            mb: 2,
          }}
        >
          {pane === 0 ? 'Map A (left)' : 'Map B (right)'}
        </Text>
      )}
      <VariableSelect pane={pane} />
      <ClimControl pane={pane} />
      {advanced && <ColormapSelect pane={pane} />}
    </Box>
  )
}

export default function Sidebar() {
  const storeReady = useAppStore((s) => s.storeReady)
  const error = useAppStore((s) => s.error)
  const mode = useAppStore((s) => s.mode)
  // Colormap choice is hidden by default: a per-student colormap makes maps
  // non-comparable across a lab group, and `defaultColormap` already picks
  // sensibly per variable.
  const [advanced, setAdvanced] = useState(false)

  return (
    <Box
      sx={{
        width: ['100%', '320px', '340px', '380px'],
        flex: 'none',
        height: '100%',
        overflowY: 'auto',
        bg: 'background',
        borderRight: '1px solid',
        borderColor: 'muted',
        px: [3, 4, 4, 4],
        py: 4,
      }}
    >
      <Image src='/leap-logo.png' width={100} height={25} alt='LEAP' />
      <Text
        as='h1'
        sx={{
          display: 'block',
          fontFamily: 'heading',
          fontSize: [4, 4, 4, 5],
          lineHeight: 'h2',
          letterSpacing: 'heading',
          mt: 3,
          mb: 1,
        }}
      >
        Earth&apos;s Radiation Budget
      </Text>
      <Text
        sx={{
          display: 'block',
          fontFamily: 'mono',
          fontSize: 0,
          letterSpacing: 'mono',
          color: 'secondary',
          mb: 4,
        }}
      >
        Satellite measurements of the energy arriving at and leaving Earth
      </Text>

      <Divider />

      {error ? (
        <Box
          sx={{
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            color: 'red',
            lineHeight: 1.5,
          }}
        >
          {error}
        </Box>
      ) : !storeReady ? (
        <Text
          sx={{
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            color: 'secondary',
          }}
        >
          reading store metadata…
        </Text>
      ) : (
        <>
          <GroupSelect />
          <ModeSelect />
          <Divider />
          <PaneControls pane={0} advanced={advanced} />
          {mode === 'diff' && <DiffControls />}
          {mode === 'compare' && <PaneControls pane={1} advanced={advanced} />}
          <Divider />
          <DimSliders />
          <Divider />
          <QueryPanel />
          <Divider />
          <Flex sx={{ mb: 2 }}>
            <UILabel sx={toggleSx}>
              <Checkbox
                checked={advanced}
                onChange={(e) => setAdvanced(e.target.checked)}
                sx={{ color: 'text', mr: 1 }}
              />
              Colormap controls
            </UILabel>
          </Flex>
        </>
      )}
    </Box>
  )
}

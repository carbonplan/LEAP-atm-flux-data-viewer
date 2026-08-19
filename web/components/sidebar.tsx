'use client'

import { useState } from 'react'
import { Box, Checkbox, Flex, Label as UILabel, Text } from 'theme-ui'
import Image from 'next/image'
import { useAppStore } from '@/lib/store'
import GroupSelect from '@/components/controls/group-select'
import VariableSelect from '@/components/controls/variable-select'
import ColormapSelect from '@/components/controls/colormap-select'
import ClimControl from '@/components/controls/clim-control'
import DimSliders from '@/components/controls/dim-sliders'
import QueryPanel from '@/components/controls/query-panel'

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

/** Variable + color controls for one map. Repeated per pane in compare mode. */
function PaneControls({ pane, advanced }: { pane: number; advanced: boolean }) {
  const compare = useAppStore((s) => s.compare)
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
  const compare = useAppStore((s) => s.compare)
  const setCompare = useAppStore((s) => s.setCompare)
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
          <Flex sx={{ mb: 4 }}>
            <UILabel sx={toggleSx}>
              <Checkbox
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
                sx={{ color: 'text', mr: 1 }}
              />
              Compare two maps
            </UILabel>
          </Flex>
          <Divider />
          <PaneControls pane={0} advanced={advanced} />
          {compare && <PaneControls pane={1} advanced={advanced} />}
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

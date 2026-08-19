'use client'

import { useMemo } from 'react'
import { Box, Flex, Input, Button } from 'theme-ui'
import { defaultClim } from '@/lib/config'
import { useAppStore } from '@/lib/store'
import Label from '@/components/controls/label'

const numberInput = {
  fontFamily: 'mono',
  fontSize: 0,
  letterSpacing: 'mono',
  px: 2,
  py: 1,
  width: '100%',
  borderColor: 'muted',
  borderRadius: 0,
}

export default function ClimControl({ pane }: { pane: number }) {
  const clim = useAppStore((s) => s.panes[pane].clim)
  const setClim = useAppStore((s) => s.setClim)
  const arrays = useAppStore((s) => s.arrays)
  const variable = useAppStore((s) => s.panes[pane].variable)
  const current = useMemo(
    () => arrays.find((a) => a.path === variable),
    [arrays, variable],
  )

  const update = (i: 0 | 1) => (raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const next: [number, number] = [...clim]
    next[i] = n
    setClim(pane, next)
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Label
        value={
          current ? (
            <Button
              onClick={() => setClim(pane, defaultClim(current))}
              sx={{
                bg: 'transparent',
                color: 'secondary',
                p: 0,
                fontFamily: 'mono',
                fontSize: 0,
                letterSpacing: 'mono',
                textTransform: 'uppercase',
                cursor: 'pointer',
                '&:hover': { color: 'text' },
              }}
            >
              reset
            </Button>
          ) : undefined
        }
      >
        Range
      </Label>
      <Flex sx={{ gap: 2, alignItems: 'center' }}>
        <Input
          type='number'
          value={clim[0]}
          onChange={(e) => update(0)(e.target.value)}
          sx={numberInput}
        />
        <Box sx={{ color: 'muted', fontFamily: 'mono', fontSize: 0 }}>to</Box>
        <Input
          type='number'
          value={clim[1]}
          onChange={(e) => update(1)(e.target.value)}
          sx={numberInput}
        />
      </Flex>
    </Box>
  )
}

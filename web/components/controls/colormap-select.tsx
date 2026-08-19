'use client'

import { Box, Flex } from 'theme-ui'
import { colormaps, useThemedColormap } from '@carbonplan/colormaps'
import { useAppStore } from '@/lib/store'
import Dropdown from '@/components/controls/dropdown'
import Label from '@/components/controls/label'

const GROUPS: Array<[string, string[]]> = [
  ['Sequential', ['sequentialSingleHue', 'sequentialMultiHue']],
  ['Diverging', ['diverging']],
  ['Cyclical', ['cyclical']],
]

export default function ColormapSelect({ pane }: { pane: number }) {
  const colormap = useAppStore((s) => s.panes[pane].colormap)
  const setColormap = useAppStore((s) => s.setColormap)
  const swatch = useThemedColormap(colormap, { format: 'hex' }) as string[]

  return (
    <Box sx={{ mb: 4 }}>
      <Label>Colormap</Label>
      <Dropdown
        value={colormap}
        onChange={(e) => setColormap(pane, e.target.value)}
      >
        {GROUPS.map(([label, types]) => (
          <optgroup key={label} label={label}>
            {colormaps
              .filter((c) => types.includes(c.type))
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Dropdown>
      <Flex sx={{ mt: 2, height: '8px', width: '100%' }}>
        {swatch.map((hex, i) => (
          <Box key={i} sx={{ flex: 1, bg: hex }} />
        ))}
      </Flex>
    </Box>
  )
}

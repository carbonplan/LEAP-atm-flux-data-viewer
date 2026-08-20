'use client'

import { Box, Checkbox, Flex, Label as UILabel } from 'theme-ui'
import { colormaps } from '@carbonplan/colormaps'
import {
  reverseColormap,
  splitColormap,
  useOrientedColormap,
} from '@/lib/colormap'
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
  const swatch = useOrientedColormap(colormap)
  // The dropdown lists base names only; orientation rides alongside it.
  const [base, reversed] = splitColormap(colormap)

  return (
    <Box sx={{ mb: 4 }}>
      <Label>Colormap</Label>
      <Dropdown
        value={base}
        onChange={(e) =>
          setColormap(pane, reversed ? `${e.target.value}_r` : e.target.value)
        }
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
          mt: 2,
        }}
      >
        <Checkbox
          checked={reversed}
          onChange={() => setColormap(pane, reverseColormap(colormap))}
          sx={{ color: 'text', mr: 1 }}
        />
        Reverse
      </UILabel>
    </Box>
  )
}

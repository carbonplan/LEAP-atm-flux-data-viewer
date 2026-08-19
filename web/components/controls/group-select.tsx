'use client'

import { useMemo } from 'react'
import { Box } from 'theme-ui'
import { groupLabel, renderable } from '@/lib/config'
import { useAppStore } from '@/lib/store'
import Dropdown from '@/components/controls/dropdown'
import Label from '@/components/controls/label'

/**
 * DataTree group picker. CERES publishes raw monthly data under `monthly` and
 * derived climatologies under `climatology/*`, so this is the "which view of
 * the record" control. Hidden entirely for a flat, single-group store.
 *
 * Subscribes to `arrays`/`variable` directly rather than the store's
 * `groups()`/`current()` accessor methods — selecting a stable function
 * reference (as `(s) => s.groups`) never changes across state updates, so
 * Zustand never re-renders this component on its own; it only appeared to
 * work when some unrelated re-render happened to catch it up.
 */
export default function GroupSelect() {
  const arrays = useAppStore((s) => s.arrays)
  const variable = useAppStore((s) => s.panes[0].variable)
  const setGroup = useAppStore((s) => s.setGroup)

  const current = useMemo(
    () => arrays.find((a) => a.path === variable),
    [arrays, variable],
  )
  const groups = useMemo(
    () => [...new Set(arrays.filter(renderable).map((a) => a.group))],
    [arrays],
  )

  if (groups.length < 2) return null

  return (
    <Box sx={{ mb: 4 }}>
      <Label>Dataset</Label>
      <Dropdown
        value={current?.group ?? ''}
        onChange={(e) => setGroup(e.target.value)}
      >
        {groups.map((g) => (
          <option key={g} value={g}>
            {groupLabel(g)}
          </option>
        ))}
      </Dropdown>
    </Box>
  )
}

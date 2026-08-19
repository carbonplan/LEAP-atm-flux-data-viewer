'use client'

import { useMemo } from 'react'
import { Box, Checkbox, Flex, Label as UILabel, Text } from 'theme-ui'
import {
  GROUP_ORDER,
  describeOf,
  groupOf,
  isLabVar,
  labelOf,
  renderable,
  units,
} from '@/lib/config'
import { useAppStore } from '@/lib/store'
import Dropdown from '@/components/controls/dropdown'
import Label from '@/components/controls/label'

export default function VariableSelect({ pane }: { pane: number }) {
  const arrays = useAppStore((s) => s.arrays)
  const variable = useAppStore((s) => s.panes[pane].variable)
  const setVariable = useAppStore((s) => s.setVariable)
  const showAll = useAppStore((s) => s.showAll)
  const setShowAll = useAppStore((s) => s.setShowAll)
  const renderables = useMemo(() => arrays.filter(renderable), [arrays])

  const current = arrays.find((a) => a.path === variable)

  // Only offer variables from the group the user is currently viewing; the
  // group itself is chosen by GroupSelect. The allowlist cuts ~48 variables
  // per group down to the dozen the labs actually use.
  const inGroup = useMemo(
    () =>
      renderables.filter(
        (v) => v.group === (current?.group ?? '') && (showAll || isLabVar(v)),
      ),
    [renderables, current?.group, showAll],
  )

  const grouped = useMemo(() => {
    const byGroup = new Map<string, typeof inGroup>()
    for (const v of inGroup) {
      const g = groupOf(v.name)
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(v)
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map(
      (g) => [g, byGroup.get(g)!] as const,
    )
  }, [inGroup])

  const u = current ? units(current) : ''

  if (renderables.length === 0) return null

  return (
    <Box sx={{ mb: 4 }}>
      <Flex sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label>Variable</Label>
        {/* Only pane 0 owns the toggle; it is a global filter, not per-pane. */}
        {pane === 0 && (
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
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              sx={{ color: 'text', mr: 1 }}
            />
            All
          </UILabel>
        )}
      </Flex>
      <Dropdown
        value={variable}
        onChange={(e) => setVariable(pane, e.target.value)}
      >
        {grouped.map(([group, vars]) => (
          <optgroup key={group} label={group}>
            {vars.map((v) => (
              <option key={v.path} value={v.path} title={describeOf(v)}>
                {labelOf(v)}
              </option>
            ))}
          </optgroup>
        ))}
      </Dropdown>
      {current && (
        <Text
          sx={{
            display: 'block',
            mt: 2,
            fontFamily: 'mono',
            fontSize: 0,
            letterSpacing: 'mono',
            color: 'secondary',
          }}
        >
          {current.name}
          {u ? ` \u00b7 ${u}` : ''}
        </Text>
      )}
    </Box>
  )
}

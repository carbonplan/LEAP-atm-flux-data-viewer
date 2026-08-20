'use client'

import { useMemo } from 'react'
import { useThemedColormap } from '@carbonplan/colormaps'

/**
 * carbonplan ships no reversed variants, so the app carries orientation in the
 * colormap name with an `_r` suffix and reverses the ramp on the way out.
 */
export function splitColormap(name: string): [string, boolean] {
  return name.endsWith('_r') ? [name.slice(0, -2), true] : [name, false]
}

export function reverseColormap(name: string): string {
  const [base, reversed] = splitColormap(name)
  return reversed ? base : `${base}_r`
}

/** `useThemedColormap`, but honouring an `_r` suffix. */
export function useOrientedColormap(name: string): string[] {
  const [base, reversed] = splitColormap(name)
  const colors = useThemedColormap(base, { format: 'hex' }) as string[]
  return useMemo(
    () => (reversed ? [...colors].reverse() : colors),
    [colors, reversed],
  )
}

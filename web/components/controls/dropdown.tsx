'use client'

import { Select } from 'theme-ui'
import type { ComponentProps } from 'react'

/**
 * The app's one <select> style, shared by every picker. Native on purpose:
 * the option list stays keyboard- and touch-native, which a custom listbox
 * would have to reimplement. Only the closed control is ours to style.
 */
export default function Dropdown(props: ComponentProps<typeof Select>) {
  return (
    <Select
      {...props}
      sx={{
        fontFamily: 'mono',
        fontSize: [1, 1, 1, 2],
        letterSpacing: 'mono',
        width: '100%',
        color: 'text',
        bg: 'transparent',
        border: '1px solid',
        borderColor: 'muted',
        borderRadius: 0,
        px: 2,
        py: 2,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: 'primary' },
        // No ring: the border carries the focus state, in the brand accent.
        '&:focus': { outline: 'none', borderColor: 'primary' },
        '&:focus-visible': { outline: 'none', borderColor: 'primary' },
        // Honoured on Windows/Linux; macOS draws the menu with OS chrome.
        '& option, & optgroup': { bg: 'background', color: 'text' },
        ...props.sx,
      }}
    />
  )
}

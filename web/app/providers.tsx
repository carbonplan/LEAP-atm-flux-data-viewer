'use client'

import { theme } from '@/styles/theme'
import { ThemeUIProvider } from 'theme-ui'

export default function Providers({
  children,
}: {
  children: React.ReactNode
}) {
  return <ThemeUIProvider theme={theme}>{children}</ThemeUIProvider>
}

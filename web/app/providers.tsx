'use client'

import { theme } from '@/styles/theme'
import { AuthProvider } from '@carbonplan/auth'
import { ThemeUIProvider } from 'theme-ui'

export default function Providers({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ThemeUIProvider theme={theme}>
      {/* useLocalStorage keeps the JWT across reloads until it expires. */}
      <AuthProvider config={{ useLocalStorage: true }}>{children}</AuthProvider>
    </ThemeUIProvider>
  )
}

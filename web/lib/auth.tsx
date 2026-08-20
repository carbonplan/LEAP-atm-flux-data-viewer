'use client'

// @carbonplan/auth's `withAuth` and `Login` are pages-router only (they import
// `useRouter` from `next/router`). `AuthProvider` and `useAuth` are router-free,
// so we keep those and port the two routed pieces to next/navigation here.
import { useAuth } from '@carbonplan/auth'
import { useRouter } from 'next/navigation'
import { useEffect, type ComponentType } from 'react'
import { Box } from 'theme-ui'

export const TOKEN_KEY = 'carbonplan-auth-token'
export const LOGIN_ROUTE = '/login'

export const setToken = (token: string) => {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch (e) {
    console.warn('localStorage is disabled so cannot persist token', e)
  }
}

export const clearToken = () => {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch (e) {
    console.warn('localStorage is disabled so cannot clear token', e)
  }
}

const Status = ({ children }: { children: React.ReactNode }) => (
  <Box
    sx={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'mono',
      fontSize: 1,
      letterSpacing: 'mono',
      color: 'secondary',
    }}
  >
    {children}
  </Box>
)

export function withAuth<P extends object>(
  Component: ComponentType<P>,
  usernames: string[] = ['admin'],
) {
  const Authed = (props: P) => {
    const router = useRouter()
    const { data, error, authed, username } = useAuth()
    const allowed = !!authed && !!username && usernames.includes(username)

    useEffect(() => {
      if ((data && !data.authed) || error) {
        clearToken()
        router.replace(
          `${LOGIN_ROUTE}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        )
      }
    }, [data, error, router])

    if (allowed) return <Component {...props} />
    if (authed && !allowed) return <Status>restricted</Status>
    return <Status>authenticating…</Status>
  }

  Authed.displayName = `withAuth(${Component.displayName ?? Component.name ?? 'Component'})`
  return Authed
}

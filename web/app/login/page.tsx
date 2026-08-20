'use client'

// App-router port of @carbonplan/auth's `Login` (which is pages-router only).
// Posts the password to /api/auth, stores the returned JWT, then returns the
// visitor to whatever page bounced them here.
import { setToken, TOKEN_KEY } from '@/lib/auth'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Box, Button, Heading, Input } from 'theme-ui'

type Status = 'submitting' | 'authenticating' | 'invalid' | null

const LoginForm = () => {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params?.get('redirect') || '/'
  const [status, setStatus] = useState<Status>(null)
  const [password, setPassword] = useState('')
  const busy = status === 'submitting' || status === 'authenticating'

  // Already holding a token: skip the form.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TOKEN_KEY)) router.replace(redirect)
    } catch {}
  }, [redirect, router])

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    setStatus('submitting')
    const res = await fetch('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ password }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (res.status !== 200) {
      setStatus('invalid')
      setTimeout(() => setStatus(null), 1000)
      return
    }
    const { token } = await res.json()
    setToken(token)
    setStatus('authenticating')
    router.replace(redirect)
  }

  return (
    <Box sx={{ maxWidth: '640px', mx: 'auto', px: [3, 4, 5], pt: [5, 6, 6] }}>
      <Heading sx={{ my: [4, 5, 5], fontSize: [6, 7, 7] }}>
        This page is private
      </Heading>
      <Box sx={{ mt: [3, 4, 4], fontSize: [4, 5, 5] }}>
        Enter a password to continue
      </Box>
      <Box as='form' onSubmit={submit} sx={{ fontSize: [4], mt: [3, 4, 4], mb: [4] }}>
        <Input
          sx={{
            width: ['200px'],
            mt: [2],
            borderStyle: 'solid',
            borderWidth: '0px',
            borderBottomWidth: '1px',
            borderColor: status === 'invalid' ? 'red' : 'secondary',
            borderRadius: '0px',
            transition: '0.15s',
            ':focus-visible': {
              outline: 'none !important',
              background: 'none !important',
              borderColor: 'primary',
            },
          }}
          type='password'
          name='password'
          id='password'
          value={password}
          placeholder={status === 'invalid' ? 'Try again' : 'Password?'}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          disabled={busy}
          type='submit'
          sx={{
            fontFamily: 'faux',
            color: 'text',
            display: 'inline-block',
            mr: [3],
            fontSize: [7],
            mt: [2],
            cursor: 'pointer',
            '&:hover': { color: busy ? 'primary' : 'secondary' },
            background: 'none',
            p: [0],
          }}
        >
          →
        </Button>
      </Box>
    </Box>
  )
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

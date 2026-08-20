// Pages-router API route backing @carbonplan/auth's client half.
//
// The README has this import `api` from '@carbonplan/auth', but that package
// has a single entry point covering both halves, so importing it here pulls
// React, theme-ui, swr and `next/router` into the serverless bundle for what
// amounts to fifteen lines of JWT logic. The token format is unchanged, so
// AuthProvider/useAuth on the client still read these responses.
import jwt from 'jsonwebtoken'
import compare from 'safe-compare'

const SECRET = process.env.JWT_SECRET
const EXPIRATION = '12h'

const users = [
  {
    username: 'user',
    password: process.env.USER_PASSWORD,
  },
]

export default function auth(req, res) {
  // Vercel injects env vars at build time and scopes them per environment, so
  // a var added after a build, or scoped to Production only, is absent here.
  // Without this the failure is a bare 500 out of jwt.sign, or a 403
  // indistinguishable from a wrong password.
  const missing = [
    !SECRET && 'JWT_SECRET',
    !process.env.USER_PASSWORD && 'USER_PASSWORD',
  ].filter(Boolean)

  if (missing.length) {
    console.error(`auth: missing env var(s): ${missing.join(', ')}`)
    return res
      .status(500)
      .json({ message: `server misconfigured: ${missing.join(', ')} unset` })
  }

  if (req.method === 'POST') {
    // safe-compare is constant-time; a plain === leaks length and prefix.
    const user = users.find((u) => compare(u.password, req.body.password))

    if (!user) {
      return res.status(403).json({ message: 'password not recognized' })
    }

    const token = jwt.sign({ username: user.username }, SECRET, {
      expiresIn: EXPIRATION,
    })
    return res.status(200).json({ username: user.username, token })
  }

  if (req.method === 'GET') {
    if (process.env.AUTH_OVERRIDE) {
      return res.status(200).json({ username: 'admin', authed: true })
    }

    try {
      const { username } = jwt.verify(req.headers.authorization, SECRET)
      return res.status(200).json({ username, authed: true })
    } catch {
      return res.status(403).json({ authed: false })
    }
  }

  return res.status(405).json({ message: 'method not allowed' })
}

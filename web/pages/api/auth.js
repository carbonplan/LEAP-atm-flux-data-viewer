// Pages-router API route: @carbonplan/auth ships a (req, res) handler, which
// the pages router consumes directly. It coexists with the app/ directory.
import { api } from '@carbonplan/auth'

const secret = process.env.JWT_SECRET

const users = [
  {
    username: 'user',
    password: process.env.USER_PASSWORD,
  },
]

const handler = api({ secret, users, expiration: '12h' })

// Without this guard a missing JWT_SECRET surfaces as a bare 500 from
// jwt.sign, and a missing USER_PASSWORD as a 403 indistinguishable from a
// wrong password. Vercel injects env vars at build time, so a var added after
// a deployment was built is absent until the next redeploy.
export default function auth(req, res) {
  const missing = [
    !secret && 'JWT_SECRET',
    !process.env.USER_PASSWORD && 'USER_PASSWORD',
  ].filter(Boolean)

  if (missing.length) {
    console.error(`auth: missing env var(s): ${missing.join(', ')}`)
    return res
      .status(500)
      .json({ message: `server misconfigured: ${missing.join(', ')} unset` })
  }

  return handler(req, res)
}

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

export default api({ secret, users, expiration: '12h' })

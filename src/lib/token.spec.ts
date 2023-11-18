import test from 'ava'
import { v4 as uuid } from 'uuid'

import { decodeToken, encodeToken } from './token.js'

test('token', t => {
  t.plan(2)

  const id = uuid()

  const encoded = encodeToken(id)
  t.like(encoded, { id })

  const decoded = decodeToken(encoded.value)
  t.like(decoded, encoded)
})

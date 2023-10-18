import test from 'ava'
import * as uuid from 'uuid'

import { decodeToken, encodeToken } from './token.js'

test('token', t => {
  t.plan(2)

  const id = uuid.v4()

  const encoded = encodeToken(id)
  t.like(encoded, { id })

  const decoded = decodeToken(encoded.value)
  t.like(decoded, encoded)
})

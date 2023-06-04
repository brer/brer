import tap from 'tap'
import * as uuid from 'uuid'

import { decodeToken, encodeToken } from './token.js'

tap.test('token', t => {
  t.plan(2)

  const id = uuid.v4()

  const encoded = encodeToken(id)
  t.match(encoded, { id })

  const decoded = decodeToken(encoded.value)
  t.match(decoded, encoded)
})

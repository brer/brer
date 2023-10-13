import test from 'ava'

import { isOlderThan } from './util.js'

test('isOlderThan', t => {
  t.plan(2)
  t.true(isOlderThan('2023-06-27T15:32:58.726Z', 600))
  t.false(isOlderThan(Date.now(), 1))
})

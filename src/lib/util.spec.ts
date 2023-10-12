import tap from 'tap'

import { isOlderThan, parseRfcDate } from './util.js'

tap.test('isOlderThan', t => {
  t.plan(2)
  t.ok(isOlderThan('2023-06-27T15:32:58.726Z', 600))
  t.notOk(isOlderThan(Date.now(), 1))
})

tap.test('parseRfcDate', t => {
  t.plan(2)

  const nano = parseRfcDate('2023-06-02T13:38:06.995487244Z') // aks
  t.ok(nano instanceof Date)
  t.equal(nano.toISOString(), '2023-06-02T13:38:06.995Z')
})

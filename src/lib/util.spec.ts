import tap from 'tap'

import { parseRfcDate } from './util.js'

tap.test('parseRfcDate', t => {
  t.plan(2)

  const nano = parseRfcDate('2023-06-02T13:38:06.995487244Z') // aks
  t.ok(nano instanceof Date)
  t.equal(nano.toISOString(), '2023-06-02T13:38:06.995Z')
})

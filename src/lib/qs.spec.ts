import tap from 'tap'

import { REG_INT, asInteger } from './qs.js'

tap.test('REG_INT', t => {
  t.plan(5)
  t.ok(REG_INT.test('0'))
  t.ok(REG_INT.test('42'))
  t.ok(REG_INT.test('-42'))
  t.ok(REG_INT.test('+42'))
  t.notOk(REG_INT.test('0 '))
})

tap.test('asInteger', t => {
  t.plan(4)
  t.equal(asInteger('0'), 0)
  t.equal(asInteger(42), 42)
  t.equal(asInteger(null), null)
  t.equal(asInteger('-2'), -2)
})

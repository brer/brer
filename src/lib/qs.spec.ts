import test from 'ava'

import { REG_INT, asInteger } from './qs.js'

test('REG_INT', t => {
  t.plan(5)
  t.true(REG_INT.test('0'))
  t.true(REG_INT.test('42'))
  t.true(REG_INT.test('-42'))
  t.true(REG_INT.test('+42'))
  t.false(REG_INT.test('0 '))
})

test('asInteger', t => {
  t.plan(4)
  t.is(asInteger('0'), 0)
  t.is(asInteger(42), 42)
  t.is(asInteger(null), null)
  t.is(asInteger('-2'), -2)
})

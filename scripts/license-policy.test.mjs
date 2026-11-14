import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowed } from './license-policy.mjs'

test('expressões SPDX exigem todas as licenças em AND e uma opção em OR', () => {
  assert.equal(allowed('MIT'), true)
  assert.equal(allowed('MIT OR GPL-3.0-only'), true)
  assert.equal(allowed('MIT AND GPL-3.0-only'), false)
  assert.equal(allowed('(MIT OR Apache-2.0) AND GPL-3.0-only'), false)
  assert.equal(allowed('GPL-3.0-only'), false)
  assert.equal(allowed('UNKNOWN'), false)
  assert.equal(allowed(''), false)
})

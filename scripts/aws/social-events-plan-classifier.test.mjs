import assert from 'node:assert/strict'
import test from 'node:test'

import { classifySocialEventsPlan } from './social-events-plan-classifier.mjs'

const emptyPlan = { resource_changes: [] }

test('plan mode accepts an already-applied zero-diff steady state', () => {
  const result = classifySocialEventsPlan(emptyPlan, 'plan')
  assert.deepEqual(result, { mode: 'steady', createCount: 0 })
})

test('apply-once mode rejects an already-applied zero-diff plan', () => {
  assert.throws(
    () => classifySocialEventsPlan(emptyPlan, 'apply-once'),
    /apply-once requires an actual create-only plan/,
  )
})

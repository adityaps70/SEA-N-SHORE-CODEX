import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const guardContractPath = 'scripts/aws/learning-foundation-migration.test.mjs'

test('learning foundation migration contract permits a one-shot apply-once guard value', () => {
  const contract = readFileSync(guardContractPath, 'utf8')

  assert.match(contract, /\['plan', 'apply-once'\]\.includes\(action\)/)
  assert.doesNotMatch(
    contract,
    /assert\.equal\(action,\s*['"]plan['"]/,
    'The migration contract must not deadlock apply-once by requiring the guard to remain plan during exact-head CI.',
  )
})

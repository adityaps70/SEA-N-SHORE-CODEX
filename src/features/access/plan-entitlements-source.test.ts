import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('runtime plan entitlements come from the database rather than duplicated plan maps', () => {
  const policy = read('src/features/access/policy.ts')
  const repository = read('src/features/access/repository.ts')

  assert.doesNotMatch(policy, /PERSONAL_PLAN_CAPABILITIES/)
  assert.doesNotMatch(policy, /ORGANIZATION_PLAN_CAPABILITIES/)
  assert.match(repository, /from public\.plan_entitlements/)
  assert.match(repository, /planEntitlementsByCode/)
  assert.match(repository, /personalEntitlements: uniqueCapabilities/)
})

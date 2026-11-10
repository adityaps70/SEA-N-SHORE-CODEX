import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Round ARCH (Phase 2): the live organization page check reads production. It must stay read-only, probe the
// page it reads from the database (never a typed slug) and prove nothing signed-in or personal is edge-cached.
const script = readFileSync('scripts/aws/org-page-edge-check.sh', 'utf8')
const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')
const cache = readFileSync('src/lib/http/public-page-cache.ts', 'utf8')

test('every AWS call is read-only, and the SQL runs in a read-only transaction that is rolled back', () => {
  const calls = [...script.matchAll(/\baws ([a-z0-9-]+) ([a-z-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)].sort(), [
    'rds describe-db-clusters',
    'rds-data begin-transaction',
    'rds-data execute-statement',
    'rds-data rollback-transaction',
    'sts get-caller-identity',
  ])
  assert.doesNotMatch(script, /commit-transaction/)
  assert.match(script, /SET TRANSACTION READ ONLY/)
  assert.match(script, /trap 'aws rds-data rollback-transaction/)
  const sql = script.slice(script.indexOf('--sql "WITH'), script.indexOf('ORDER BY slug'))
  assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|create|grant|truncate)\b/i)
  assert.match(script, /310356785722/)
})

test('the probed page comes from the database, by the public site host or the brand name, exactly one', () => {
  assert.match(script, /scripts\/aws\/public-site-url\.txt/)
  assert.match(script, /stringValue\\":\\"\$SITE_HOST/)
  assert.match(script, /lower\(btrim\(name\)\) = 'sea n shore'/)
  assert.match(script, /claim_status', 'claimed'\) = 'claimed'/)
  assert.match(script, /coalesce\(is_verified, false\)/)
  assert.match(script, /\$\{#SLUGS\[@\]\}" -eq 1/)
  assert.match(script, /\[\[ "\$SLUG" =~ \^\[a-z0-9\]\[a-z0-9-\]\*\$ \]\]/)
  assert.doesNotMatch(script, /organizations\/[a-z0-9-]+-[a-z0-9]/, 'no typed slug')
})

test('it proves a signed-out hit with the organization header and never a hit or public with a session or on manage', () => {
  const header = cache.match(/ORGANIZATION_PAGE_CACHE_CONTROL = '([^']+)'/)?.[1]
  assert.ok(header)
  assert.ok(script.includes(`ORG_HEADER='${header}'`), 'the check expects the header the app sends')
  assert.match(script, /edge_probe=/)
  assert.match(script, /x-cache: hit from cloudfront/)
  assert.match(script, /grep -q 'sns_' "\$BODY"/)
  assert.match(script, /Cookie: sns_cognito_access=edge-probe-not-a-session/)
  assert.match(script, /\/organizations\/\$SLUG\/manage/)
  assert.match(script, /for attempt in 1 2 3; do/)
  assert.match(script, /^echo 'ORG_PAGE_SIGNED_IN_AND_PERSONAL_NEVER_EDGE_CACHED_VERIFIED=true'$/m)
})

test('Remote Verify runs it after every deploy and reads only its evidence line', () => {
  assert.match(workflow, /public-organization-page-cache:\n\s+runs-on: ubuntu-latest\n\s+environment: staging\n\s+timeout-minutes: 10/)
  assert.match(workflow, /bash scripts\/aws\/org-page-edge-check\.sh \| tee \/tmp\/org-page-edge-check\.log/)
  assert.match(workflow, /grep -qx 'ORG_PAGE_SIGNED_IN_AND_PERSONAL_NEVER_EDGE_CACHED_VERIFIED=true' \/tmp\/org-page-edge-check\.log/)
})

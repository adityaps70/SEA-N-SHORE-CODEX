import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('edge recovery scopes the app distribution while allowing the tracked legacy redirect distribution', async () => {
  const script = await read('./edge-recovery.sh')

  assert.ok(script.includes('select(.type == "aws_cloudfront_distribution" and .name == "app" and .mode == "managed")'))
  assert.ok(script.includes('select(.type == "aws_cloudfront_distribution" and .name == "seaandshore_redirect" and .mode == "managed")'))
  assert.match(script, /LIVE_CLOUDFRONT_DISTRIBUTIONS_VERIFIED=true/)
  assert.doesNotMatch(script, /Unexpected distributions in state/)
  assert.doesNotMatch(script, /DistributionList\.Quantity == 1 and \.DistributionList\.Items\[0\]\.Id == \$id/)
})

test('Round P3: the one known untracked distribution is allowed by exact id, and any other still stops the run', async () => {
  const script = await read('./edge-recovery.sh')
  assert.match(script, /KNOWN_UNTRACKED_CF_IDS='\["E2MCZ79G101LLD"\]'/)
  assert.ok(script.includes("(([.DistributionList.Items[]?.Id] - $known) | sort) == ([$app, $legacy] | sort)"))
  assert.match(script, /Unexpected CloudFront distributions: /)
  // The plan stays targeted at the app distribution; the known one is never a target.
  assert.doesNotMatch(script, /-target=[^ ]*E2MCZ79G101LLD/)
})

test('the edge health check sends the health check token to /api/health/home from a private file, never in argv or the log', async () => {
  const script = await read('./edge-recovery.sh')
  assert.match(script, /--secret-id sea-n-shore-staging\/health-check-token/)
  assert.match(script, /-H @"\$RECOVERY_DIR\/health-check-header" "https:\/\/\$DOMAIN\/api\/health\/home"/)
  assert.doesNotMatch(script, /echo[^\n]*health-check-token\)/)
  assert.doesNotMatch(script, /x-health-check-token: \$[A-Z]/)
})


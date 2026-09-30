import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('edge recovery scopes the app distribution while allowing the tracked legacy redirect distribution', async () => {
  const script = await read('./edge-recovery.sh')

  assert.match(script, /select\(\.type == "aws_cloudfront_distribution" and \.name == "app"\)/)
  assert.match(script, /select\(\.type == "aws_cloudfront_distribution" and \.name == "seaandshore_redirect"\)/)
  assert.match(script, /LIVE_CLOUDFRONT_DISTRIBUTIONS_VERIFIED=true/)
  assert.doesNotMatch(script, /Unexpected distributions in state/)
  assert.doesNotMatch(script, /DistributionList\.Quantity == 1 and \.DistributionList\.Items\[0\]\.Id == \$id/)
})

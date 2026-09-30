import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('edge state audit treats the two repository CloudFront Functions as supported live resources', async () => {
  const script = await read('./audit-edge-state.sh')

  assert.match(script, /aws_cloudfront_function\)/)
  assert.match(script, /aws cloudfront describe-function/)
  assert.match(script, /sea-n-shore-staging-canonical-host-redirect/)
  assert.match(script, /sea-n-shore-staging-legacy-domain-redirect/)
  assert.match(script, /LIVE=true id=\$id name=\$live_name/)
})

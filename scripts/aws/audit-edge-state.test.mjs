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
  // Each function name is accepted only at its own address; the imported console function keeps its console name
  // (run 44995642725 refused it as an unexpected name).
  assert.match(script, /case "\$state_name:\$live_name" in/)
  assert.match(script, /canonical_host_redirect:sea-n-shore-staging-canonical-host-redirect\|legacy_domain_redirect:sea-n-shore-staging-legacy-domain-redirect\) ;;/)
  assert.match(script, /\n\s+console_redirect:seanshore-redirect-domains\) ;;/)
  assert.match(script, /LIVE=true id=\$id name=\$live_name/)
})

test('edge state audit has a read-only live check for every CloudFront/WAF resource type the app declares', async () => {
  const script = await read('./audit-edge-state.sh')
  const { readdir } = await import('node:fs/promises')
  const appDir = new URL('../../infra/aws/app/', import.meta.url)
  const types = new Set()
  for (const name of (await readdir(appDir)).filter((n) => n.endsWith('.tf'))) {
    for (const m of (await readFile(new URL(name, appDir), 'utf8')).matchAll(/resource "(aws_(?:cloudfront|wafv2)_[a-z_]+)"/g)) types.add(m[1])
  }
  assert.ok(types.has('aws_cloudfront_cache_policy'))
  for (const type of types) assert.match(script, new RegExp(`^    ${type}\\)$`, 'm'), `${type} has no live check`)

  // The cache policy check only reads, and compares id and name with state.
  assert.match(script, /aws cloudfront get-cache-policy --id "\$id" --output json/)
  assert.match(script, /\.CachePolicy\.Id == \$id and \.CachePolicy\.CachePolicyConfig\.Name == \$name/)
  assert.doesNotMatch(script, /aws cloudfront (create|update|delete)-/)
})

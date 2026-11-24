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

// Domain move (Option A: media signed for any host): the audit proves the signed-media key group is trusted only by
// the main distribution and its public key is in no other key group. The script's own block runs on fixtures.
test('edge state audit: the signed-media key group is trusted only by the main distribution', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const script = await read('./audit-edge-state.sh')
  const start = script.indexOf('echo "=== SIGNED MEDIA KEY GROUP USE (READ ONLY) ==="')
  const end = script.indexOf('echo\n[[ "$LIVE_CHECK_FAILED" == 0 ]]', start)
  assert.ok(start > 0 && end > start, 'the key group check runs before the live-check verdict')
  const block = script.slice(start, end)

  const edge = [
    { type: 'aws_cloudfront_key_group', name: 'media_cdn', instances: [{ id: 'KG1' }] },
    { type: 'aws_cloudfront_public_key', name: 'media_cdn', instances: [{ id: 'PK1' }] },
    { type: 'aws_cloudfront_distribution', name: 'app', instances: [{ id: 'EAPP' }] },
  ]
  const behaviour = (groups) => ({ TrustedKeyGroups: { Enabled: groups.length > 0, Quantity: groups.length, Items: groups } })
  const distribution = (id, media) => ({ Id: id, DefaultCacheBehavior: behaviour([]), CacheBehaviors: { Items: [behaviour(media ? ['KG1'] : [])] } })
  const run = (distributions, keyGroups) => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-keygroup-'))
    writeFileSync(join(dir, 'edge.json'), JSON.stringify(edge))
    writeFileSync(join(dir, 'distributions.json'), JSON.stringify({ DistributionList: { Items: distributions } }))
    writeFileSync(join(dir, 'kg.json'), JSON.stringify({ KeyGroupList: { Items: keyGroups.map((g) => ({ KeyGroup: g })) } }))
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash\n[[ "$1 $2" == "cloudfront list-key-groups" ]] && exec cat ${JSON.stringify(join(dir, 'kg.json'))}\nexit 2\n`)
    chmodSync(join(dir, 'aws'), 0o755)
    const program = `set -euo pipefail\nEDGE_JSON=${JSON.stringify(join(dir, 'edge.json'))}\nEVIDENCE_DIR=${JSON.stringify(dir)}\nLIVE_CHECK_FAILED=0\n${block}\necho "FAILED=$LIVE_CHECK_FAILED"\n`
    return execFileSync('bash', ['-c', program], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })
  }
  const mainKeyGroup = { Id: 'KG1', KeyGroupConfig: { Items: ['PK1'] } }

  const ok = run([distribution('EAPP', true), distribution('EREDIRECT', false), distribution('ECONSOLE', false)], [mainKeyGroup])
  assert.match(ok, /^EDGE_AUDIT_MEDIA_KEY_GROUP_DISTRIBUTIONS=1 only_main=true$/m)
  assert.match(ok, /^EDGE_AUDIT_MEDIA_PUBLIC_KEY_OTHER_KEY_GROUPS=0$/m)
  assert.match(ok, /^FAILED=0$/m)

  const shared = run([distribution('EAPP', true), distribution('EOTHER', true)], [mainKeyGroup])
  assert.match(shared, /^EDGE_AUDIT_MEDIA_KEY_GROUP_DISTRIBUTIONS=2 only_main=false$/m)
  assert.match(shared, /^FAILED=1$/m)

  const elsewhere = run([distribution('EAPP', false), distribution('EOTHER', true)], [mainKeyGroup])
  assert.match(elsewhere, /^EDGE_AUDIT_MEDIA_KEY_GROUP_DISTRIBUTIONS=1 only_main=false$/m)
  assert.match(elsewhere, /^FAILED=1$/m)

  const keyReused = run([distribution('EAPP', true)], [mainKeyGroup, { Id: 'KG2', KeyGroupConfig: { Items: ['PK1'] } }])
  assert.match(keyReused, /^EDGE_AUDIT_MEDIA_PUBLIC_KEY_OTHER_KEY_GROUPS=1$/m)
  assert.match(keyReused, /^FAILED=1$/m)
})

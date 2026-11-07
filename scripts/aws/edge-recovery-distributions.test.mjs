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


test('ARCH decision 6: the post-apply WAF check accepts the live ship-IP rules and refuses looser or partial ones', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const script = await read('./edge-recovery.sh')
  const check = /\npython3 - "\$RECOVERY_DIR\/live-waf\.json" <<'PY'\n([\s\S]*?)\nPY\n/.exec(script)[1]
  // Rule definitions read from the live web ACL by the edge-state audit after the ship-IP apply (no ids or secrets).
  const live = JSON.parse(await read('./fixtures/edge-waf-ship-ip.json'))
  const dir = mkdtempSync(join(tmpdir(), 'waf-check-'))
  const run = (waf) => {
    writeFileSync(join(dir, 'check.py'), check)
    writeFileSync(join(dir, 'waf.json'), JSON.stringify(waf))
    try {
      return { ok: true, out: execFileSync('python3', ['-I', join(dir, 'check.py'), join(dir, 'waf.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
    } catch {
      return { ok: false }
    }
  }
  const variant = (change) => { const waf = structuredClone(live); change(waf.WebACL.Rules); return waf }
  const rule = (rules, name) => rules.find((r) => r.Name === name)
  try {
    const accepted = run(live)
    assert.ok(accepted.ok)
    assert.match(accepted.out, /SHIP_IP_RATE_LIMITS_VERIFIED=true/)
    // The pre-change shape (media exception only, no ship-IP rules) still passes, without the ship-IP line.
    const before = run(variant((rules) => {
      const rate = rule(rules, 'PerIpRateLimit').Statement.RateBasedStatement
      rate.ScopeDownStatement = rate.ScopeDownStatement.AndStatement.Statements[0]
      rules.splice(0, rules.length, ...rules.filter((r) => !['PerSessionRateLimit', 'PerIpCeiling'].includes(r.Name)))
    }))
    assert.ok(before.ok)
    assert.doesNotMatch(before.out, /SHIP_IP/)
    for (const [label, change] of [
      ['ceiling raised', (rules) => { rule(rules, 'PerIpCeiling').Statement.RateBasedStatement.Limit = 100000 }],
      ['session limit raised', (rules) => { rule(rules, 'PerSessionRateLimit').Statement.RateBasedStatement.Limit = 5000 }],
      ['other cookie', (rules) => { rule(rules, 'PerSessionRateLimit').Statement.RateBasedStatement.CustomKeys[0].Cookie.Name = 'other' }],
      ['session rule missing', (rules) => { rules.splice(rules.indexOf(rule(rules, 'PerSessionRateLimit')), 1) }],
      ['ceiling missing', (rules) => { rules.splice(rules.indexOf(rule(rules, 'PerIpCeiling')), 1) }],
      ['signed-out scope without its rules', (rules) => { rules.splice(0, rules.length, ...rules.filter((r) => !['PerSessionRateLimit', 'PerIpCeiling'].includes(r.Name))) }],
      ['rules without the signed-out scope', (rules) => {
        const rate = rule(rules, 'PerIpRateLimit').Statement.RateBasedStatement
        rate.ScopeDownStatement = rate.ScopeDownStatement.AndStatement.Statements[0]
      }],
      ['signed-out limit raised', (rules) => { rule(rules, 'PerIpRateLimit').Statement.RateBasedStatement.Limit = 10000 }],
    ]) {
      assert.equal(run(variant(change)).ok, false, label)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

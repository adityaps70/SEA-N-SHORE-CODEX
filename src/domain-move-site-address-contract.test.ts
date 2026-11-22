import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PUBLIC_SITE_URL } from '@/config/public-site'
import { parseSiteAliasHosts } from '@/lib/site-url'

// Domain move (owner, 17 Nov): one setting drives the site address. scripts/aws/public-site-url.txt is the canonical
// origin; scripts/aws/site-alias-hosts.txt lists the other hosts the site answers on during the move. No other code
// may name a Sea N Shore domain, except the cases below, each with its reason.
const read = (file: string) => fs.readFileSync(file, 'utf8')
const canonical = read('scripts/aws/public-site-url.txt').trim()
const DOMAIN = /\b(seanshore|seaandshore)\.(in|net|ph|nl|si|com)\b/i

const ALLOWED: { reason: string; files?: RegExp; line: RegExp }[] = [
  { reason: 'the one code default, kept equal to public-site-url.txt (below)', files: /^src\/config\/public-site\.ts$/, line: /^export const DEFAULT_PUBLIC_SITE_URL = 'https:\/\/[a-z.]+'$/ },
  { reason: 'the Cognito email Lambda ships alone (no shared config); kept equal to public-site-url.txt (below)', files: /^infra\/aws\/app\/lambda\/cognito-resend-email-sender\.mjs$/, line: /^const DEFAULT_SITE_URL = 'https:\/\/[a-z.]+'$/ },
  { reason: 'From addresses stay on mail.seanshore.in until the owner moves them (about 2 weeks after the switch)', line: /<[a-z]+@mail\.seanshore\.in>/ },
  { reason: 'synthetic phone sign-in identities are stored data, not links', line: /@auth\.seaandshore\.in\b/ },
  { reason: 'calendar UIDs must never change (a new UID duplicates the event in every calendar)', files: /^src\/(app\/\(app\)\/events\/\[eventId\]\/calendar\/route|features\/learning\/sessions\/session-calendar)\.ts$/, line: /(UID:\$\{event\.id\}@seaandshore\.in|learning-session-\$\{session\.id\}@seanshore\.in)/ },
  { reason: 'Instagram and Facebook account names, not our domain', line: /(instagram|facebook)\.com\/seaandshore\.in|instagram: 'seaandshore\.in'|e\.g\. seaandshore\.in|for example seaandshore\.in/ },
  { reason: 'the finished legacy seaandshore.in campaign (owner: leave as is)', files: /^src\/(features\/legacy-invites\/|app\/\(marketing\)\/email\/legacy\/)/, line: /./ },
  // Run 44995638740: a Lambda's code hash covers its comments, so rewording one redeploys it. These two comments stay
  // as deployed until each Lambda is next changed for its own reason (the serve step must not redeploy them).
  { reason: 'comments kept byte for byte so the deployed Lambdas do not change', files: /^infra\/aws\/app\/lambda\/(cognito-resend-email-sender|realtime-authorizer)\.mjs$/, line: /^(\/\/ dependencies\), then send a branded email through Resend from the verified mail\.seanshore\.in|\/\*\* Comma-separated browser origins \(https:\/\/seanshore\.in,https:\/\/<edge>\.cloudfront\.net\); trailing slashes ignored\. \*\/)$/ },
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__fixtures__') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.(test|spec)\.[a-z]+$/.test(entry.name)) {
      out.push(full.split(path.sep).join('/'))
    }
  }
  return out
}

describe('domain move: one site address', () => {
  it('the code default equals scripts/aws/public-site-url.txt, and so does the email Lambda', () => {
    expect(canonical).toMatch(/^https:\/\/[a-z0-9.-]+$/)
    expect(DEFAULT_PUBLIC_SITE_URL).toBe(canonical)
    expect(read('infra/aws/app/lambda/cognito-resend-email-sender.mjs')).toContain(`const DEFAULT_SITE_URL = '${canonical}'`)
  })

  it('the alias host list holds plain hostnames only, never the canonical host', () => {
    const text = read('scripts/aws/site-alias-hosts.txt')
    const hosts = parseSiteAliasHosts(text)
    expect(text.split(/\s+/).filter(Boolean)).toEqual(hosts)
    expect(hosts).not.toContain(new URL(canonical).host)
  })

  it('no code names a Sea N Shore domain outside config and the allowed cases', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('src'), ...sourceFiles('scripts/workers'), ...sourceFiles('infra/aws/app/lambda')]) {
      read(file).split('\n').forEach((line, index) => {
        if (!DOMAIN.test(line)) return
        const allowed = ALLOWED.some((rule) => (!rule.files || rule.files.test(file)) && rule.line.test(line.trim()))
        if (!allowed) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('redirects a member follows and provider return URLs use the visitor origin', () => {
    const uses = (file: string, pattern: RegExp) => expect(read(file), file).toMatch(pattern)
    uses('src/app/auth/google/start/route.ts', /siteUrl: siteOriginFor\(request\.headers\)/)
    uses('src/app/auth/google/callback/route.ts', /siteUrl: siteOriginFor\(request\.headers\)/)
    uses('src/app/api/auth/app-handoff/route.ts', /siteUrl: siteOriginFor\(request\.headers\)/)
    uses('src/features/auth/actions.ts', /siteUrl: await currentSiteOrigin\(\)/)
    uses('src/app/api/learning/scorm/[lessonId]/content/[...path]/route.ts', /injectScormBridge\(.*, siteOriginFor\(request\.headers\)\)/)
    for (const file of ['src/features/payments/event-payment-runtime.ts', 'src/features/learning/course-payment-runtime.ts']) uses(file, /returnSiteUrl: currentSiteOrigin/)
    uses('src/features/billing/subscription-service.ts', /createSubscriptionService\(\{ returnSiteUrl: currentSiteOrigin \}\)/)
    // The Cashfree webhook URL stays on the canonical site.
    for (const file of ['src/features/payments/event-payment-service.ts', 'src/features/learning/course-payment-service.ts']) {
      uses(file, /returnUrl: paymentReturnUrl\(await returnSiteUrl\(\), reference\)/)
      uses(file, /notifyUrl: cashfreeNotifyUrl\(siteUrl\(\)\)/)
    }
    // Nothing in the Google routes still redirects to the canonical site directly.
    for (const file of ['src/app/auth/google/start/route.ts', 'src/app/auth/google/callback/route.ts', 'src/app/auth/session-ended/route.ts']) {
      expect(read(file), file).not.toMatch(/siteUrlFor\(/)
    }
  })

  it('the request-origin helper loads next/headers lazily (the outbox worker bundles the billing service)', () => {
    const helper = read('src/lib/site-url-request.ts')
    expect(helper).toMatch(/await import\('next\/headers'\)/)
    expect(helper).not.toMatch(/^import [^\n]*from 'next\/headers'/m)
    // site-url.ts reads NEXT_PUBLIC_SITE_URL on load; workers do not set it (scripts/workers/worker-imports.test.mjs).
    expect(helper).toMatch(/await import\('@\/lib\/site-url'\)/)
    expect(helper).not.toMatch(/^import /m)
  })

  it('next.config inlines the alias hosts and lets Server Actions accept them', () => {
    const config = read('next.config.ts')
    expect(config).toMatch(/const SITE_ALIAS_HOSTS_FILE = 'scripts\/aws\/site-alias-hosts\.txt'/)
    expect(config).toMatch(/env: \{ NEXT_PUBLIC_APP_BUILD_ID: APP_BUILD_ID, SITE_ALIAS_HOSTS \}/)
    expect(config).toMatch(/SITE_ALIAS_HOSTS\.split\(','\)\.filter\(Boolean\)\.map\(\(host\) => `https:\/\/\$\{host\}`\)/)
  })
})

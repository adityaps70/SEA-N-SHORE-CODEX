// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getMediaObject: vi.fn(),
  getVerifiedUser: vi.fn(async () => {
    throw new Error('the public logo route must never look at the session')
  }),
}))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/lib/db/client', () => ({ query: mocks.query }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject: mocks.getMediaObject }))

import { GET } from './route'
import {
  PUBLIC_COMPANY_LOGO_CACHE_CONTROL,
  PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS,
} from '@/features/organizations/company-logo-path'
import { mediaCdnAccessFor } from '@/lib/media-cdn/media-cdn'
import { MEDIA_CDN_WINDOW_SECONDS } from '@/lib/media-cdn/signer'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const ROUTE_FILE = 'src/app/api/public/company-logo/[companyId]/route.ts'
const get = (id = COMPANY, headers: Record<string, string> = {}) =>
  GET(new Request(`https://seanshore.in/api/public/company-logo/${id}`, { headers }), { params: Promise.resolve({ companyId: id }) })

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const SIGNING_ENV = {
  MEDIA_CDN_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  MEDIA_CDN_KEY_PAIR_ID: 'K2JCJMDEHXQW5F',
  MEDIA_CDN_ORIGIN: 'https://seanshore.in',
}

function signedExpiry(location: string) {
  const policy = new URL(location, 'https://seanshore.in').searchParams.get('Policy')!
  const json = Buffer.from(policy.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64').toString()
  return JSON.parse(json).Statement[0].Condition.DateLessThan['AWS:EpochTime'] as number
}

describe('GET /api/public/company-logo/[companyId] (request cuts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png', contentLength: 3 })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('serves a verified organization\'s logo to anyone, cacheable at the browser and CloudFront', async () => {
    mocks.query.mockResolvedValue([{ logo_path: 'organizations/c1/logo-a.png', is_verified: true }])
    const response = await get(COMPANY, { cookie: 'sns_cognito_access=ignored' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(PUBLIC_COMPANY_LOGO_CACHE_CONTROL)
    expect(PUBLIC_COMPANY_LOGO_CACHE_CONTROL).toBe('public, max-age=3600, s-maxage=3600')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.getVerifiedUser).not.toHaveBeenCalled()
  })

  it('never serves an unverified organization\'s logo, signed in or not', async () => {
    for (const isVerified of [false, null]) {
      mocks.query.mockResolvedValue([{ logo_path: 'companies/logo.png', is_verified: isVerified }])
      const response = await get(COMPANY, { cookie: 'sns_cognito_access=member' })
      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
    }
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
    expect(mocks.getVerifiedUser).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown organization, one without a logo, or a malformed id (no query)', async () => {
    mocks.query.mockResolvedValue([])
    expect((await get()).status).toBe(404)
    mocks.query.mockResolvedValue([{ logo_path: '  ', is_verified: true }])
    expect((await get()).status).toBe(404)
    mocks.query.mockClear()
    expect((await get('not-a-uuid')).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('never reads cookies, headers or the session', () => {
    const code = readFileSync(ROUTE_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/features\/auth|lib\/auth|next\/headers|cookies|getVerifiedUser|headers\.get|_request\.|request\.(headers|cookies)/)
    // The request argument stays unused.
    expect(code).toMatch(/GET\(\s*_request: Request,/)
  })

  it('redirects to the signed CDN size, and a cached redirect never outlives the signature', async () => {
    for (const [name, value] of Object.entries(SIGNING_ENV)) vi.stubEnv(name, value)
    for (const logoPath of ['organizations/c1/logo-a.png', 'companies/legacy-logo.jpg']) {
      mocks.query.mockResolvedValue([{ logo_path: logoPath, is_verified: true }])
      // Sample across a whole signing window, including just before a window ends.
      const window = MEDIA_CDN_WINDOW_SECONDS[mediaCdnAccessFor(logoPath)]
      for (let step = 0; step <= 8; step += 1) {
        const now = Date.UTC(2026, 10, 18) + Math.floor((window * 1000 * step) / 8) - (step === 8 ? 1000 : 0)
        vi.useFakeTimers({ now, toFake: ['Date'] })
        const response = await get()
        expect(response.status).toBe(302)
        expect(response.headers.get('cache-control')).toBe(PUBLIC_COMPANY_LOGO_CACHE_CONTROL)
        const location = response.headers.get('location')!
        expect(location).toMatch(/^\/m\/i\/[^/]+\/\d+\.webp\?Policy=/)
        const remaining = signedExpiry(location) - Math.floor(now / 1000)
        // Browser and CloudFront may each keep it for the max age; leave an hour to spare on top.
        expect(remaining).toBeGreaterThan(2 * PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS + 3600)
        vi.useRealTimers()
      }
    }
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
  })

  it('keeps the cache lifetime well inside every signing window a logo can get', () => {
    for (const logoPath of ['organizations/c1/logo-a.png', 'companies/legacy-logo.jpg']) {
      const window = MEDIA_CDN_WINDOW_SECONDS[mediaCdnAccessFor(logoPath)]
      // A signature is valid for at least one whole window (signer.ts), so this always leaves an hour or more.
      expect(2 * PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS + 3600).toBeLessThan(window)
    }
  })

  it('matches the CloudFront behaviour: cookie-free, keyed on the path and v, capped at the same max age', () => {
    const tf = readFileSync('infra/aws/app/edge.tf', 'utf8')
    const policy = /resource "aws_cloudfront_cache_policy" "public_company_logo" \{([\s\S]*?)\n\}/.exec(tf)?.[1] ?? ''
    expect(policy).toMatch(/min_ttl\s+= 0\n/)
    expect(policy).toMatch(/default_ttl\s+= 0\n/)
    expect(policy).toMatch(new RegExp(`max_ttl\\s+= ${PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS}\\n`))
    expect(policy).toMatch(/cookie_behavior = "none"/)
    expect(policy).toMatch(/header_behavior = "none"/)
    expect(policy).toMatch(/query_string_behavior = "whitelist"[\s\S]*items = \["v"\]/)
    const behavior = /ordered_cache_behavior \{\n\s+path_pattern\s+= "\/api\/public\/company-logo\/\*"([\s\S]*?)\n  \}/.exec(tf)?.[1] ?? ''
    expect(behavior).toMatch(/cache_policy_id\s+= aws_cloudfront_cache_policy\.public_company_logo\.id/)
    expect(behavior).not.toMatch(/origin_request_policy_id/)
    expect(behavior).toMatch(/allowed_methods\s+= \["GET", "HEAD"\]/)
  })
})

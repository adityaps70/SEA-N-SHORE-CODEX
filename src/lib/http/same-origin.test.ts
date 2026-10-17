import { describe, expect, it } from 'vitest'
import { isSameSiteRequest } from './same-origin'

const env = { siteUrl: 'https://seanshore.in', additionalOrigins: 'https://d3prih0q6jofyr.cloudfront.net' }

function request(headers: Record<string, string>, url = 'http://sea-n-shore-staging-alb-123.ap-south-1.elb.amazonaws.com/api/feed/impressions') {
  return new Request(url, { method: 'POST', headers })
}

describe('isSameSiteRequest', () => {
  it('accepts the public site behind CloudFront, where Host and X-Forwarded-Host are not the site name', () => {
    const behindCloudFront = request({
      origin: 'https://seanshore.in',
      host: 'sea-n-shore-staging-alb-123.ap-south-1.elb.amazonaws.com',
      'x-forwarded-host': 'd3prih0q6jofyr.cloudfront.net',
    })
    expect(isSameSiteRequest(behindCloudFront, env)).toBe(true)
  })

  it('accepts a request the browser marks same-origin', () => {
    expect(isSameSiteRequest(request({ origin: 'https://seanshore.in', 'sec-fetch-site': 'same-origin' }), {})).toBe(true)
  })

  it('accepts a request without an Origin header', () => {
    expect(isSameSiteRequest(request({}), env)).toBe(true)
  })

  it('accepts local development, where Origin matches the request host', () => {
    expect(isSameSiteRequest(request({ origin: 'http://localhost:3000', host: 'localhost:3000' }, 'http://localhost:3000/api/feed/impressions'), {})).toBe(true)
  })

  it('refuses another site', () => {
    expect(isSameSiteRequest(request({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env)).toBe(false)
    expect(isSameSiteRequest(request({ origin: 'https://seanshore.in.evil.example' }), env)).toBe(false)
  })

  it('refuses a malformed or opaque Origin', () => {
    expect(isSameSiteRequest(request({ origin: 'not a url' }), env)).toBe(false)
    expect(isSameSiteRequest(request({ origin: 'null' }), env)).toBe(false)
  })
})

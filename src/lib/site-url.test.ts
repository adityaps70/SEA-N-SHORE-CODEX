import { describe, expect, it } from 'vitest'
import { siteOrigin, siteUrlFor } from './site-url'

describe('site-url', () => {
  it('builds absolute URLs on the configured public site, never the request host', () => {
    expect(siteUrlFor('/auth/post-sign-in').toString()).toBe('http://localhost:3000/auth/post-sign-in')
    expect(siteUrlFor('/jobs/applications?cv=missing').toString()).toBe('http://localhost:3000/jobs/applications?cv=missing')
    expect(siteOrigin()).toBe('http://localhost:3000')
  })
})

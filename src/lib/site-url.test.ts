import { describe, expect, it } from 'vitest'
import { parseSiteAliasHosts, siteOrigin, siteOriginFor, siteOrigins, siteUrlFor, VIEWER_HOST_HEADER } from './site-url'

describe('site-url', () => {
  it('builds absolute URLs on the configured public site, never the request host', () => {
    expect(siteUrlFor('/auth/post-sign-in').toString()).toBe('http://localhost:3000/auth/post-sign-in')
    expect(siteUrlFor('/jobs/applications?cv=missing').toString()).toBe('http://localhost:3000/jobs/applications?cv=missing')
    expect(siteOrigin()).toBe('http://localhost:3000')
  })
})

// Domain move: a visitor on an alias host stays on it for redirects and provider returns; everything else is canonical.
describe('site-url: the visitor origin during a domain move', () => {
  const config = { canonical: 'https://main.example', aliases: ['alias.example'] }
  const headers = (host?: string) => new Headers(host === undefined ? {} : { [VIEWER_HOST_HEADER]: host })

  it('keeps a visitor on an alias host, on https only', () => {
    expect(siteOriginFor(headers('alias.example'), config)).toBe('https://alias.example')
    expect(siteOriginFor(headers('ALIAS.example '), config)).toBe('https://alias.example')
    expect(siteOriginFor(headers('alias.example'), { ...config, canonical: 'http://localhost:3000' })).toBe('http://localhost:3000')
  })

  it('falls back to the canonical origin for anything else', () => {
    expect(siteOriginFor(headers(), config)).toBe('https://main.example')
    expect(siteOriginFor(null, config)).toBe('https://main.example')
    expect(siteOriginFor(headers('main.example'), config)).toBe('https://main.example')
    expect(siteOriginFor(headers('evil.example'), config)).toBe('https://main.example')
    expect(siteOriginFor(headers('alias.example.evil.example'), config)).toBe('https://main.example')
    expect(siteOriginFor(headers('alias.example:8443'), config)).toBe('https://main.example')
    expect(siteOriginFor(headers('https://alias.example'), config)).toBe('https://main.example')
  })

  it('reads the alias host list strictly', () => {
    expect(parseSiteAliasHosts('alias.example, other.example\nalias.example')).toEqual(['alias.example', 'other.example'])
    expect(parseSiteAliasHosts('https://x.example,*.example,bad host,localhost,')).toEqual([])
    expect(parseSiteAliasHosts(undefined)).toEqual([])
  })

  it('lists the site origins canonical first', () => {
    const previous = process.env.SITE_ALIAS_HOSTS
    process.env.SITE_ALIAS_HOSTS = 'alias.example'
    try {
      expect(siteOrigins()).toEqual(['http://localhost:3000', 'https://alias.example'])
    } finally {
      if (previous === undefined) delete process.env.SITE_ALIAS_HOSTS
      else process.env.SITE_ALIAS_HOSTS = previous
    }
  })
})

import { describe, expect, it } from 'vitest'
import { USER_WEBSITE_REL, userWebsiteHref } from './user-website'

describe('user website links (Round H, H7)', () => {
  it('marks user-entered links nofollow, ugc and noopener', () => {
    expect(USER_WEBSITE_REL.split(' ')).toEqual(expect.arrayContaining(['nofollow', 'ugc', 'noopener']))
  })

  it('accepts http(s) websites and bare domains', () => {
    expect(userWebsiteHref('https://example.com/about')).toBe('https://example.com/about')
    expect(userWebsiteHref('http://example.com')).toBe('http://example.com/')
    expect(userWebsiteHref('  example.com ')).toBe('https://example.com/')
  })

  it('refuses other schemes and junk', () => {
    expect(userWebsiteHref('javascript:alert(1)')).toBeNull()
    expect(userWebsiteHref('mailto:someone@example.com')).toBeNull()
    expect(userWebsiteHref('not a site')).toBeNull()
    expect(userWebsiteHref('localhost')).toBeNull()
    expect(userWebsiteHref('')).toBeNull()
    expect(userWebsiteHref(null)).toBeNull()
  })
})

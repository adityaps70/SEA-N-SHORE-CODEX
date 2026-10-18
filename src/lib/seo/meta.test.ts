import { describe, expect, it } from 'vitest'
import { canonicalPath, jsonLd, metaDescription, plainText } from './meta'

describe('meta descriptions (Round H, H5)', () => {
  it('strips Markdown, emoji and line breaks', () => {
    expect(plainText('**Good Morning!** 🌊⚓\n\n- Join our _crew_ [today](https://example.com)')).toBe('Good Morning! Join our crew today')
  })

  it('keeps 150–160 characters, cut at a word', () => {
    const long = 'Chief Officer wanted for a modern oil tanker fleet trading worldwide with competitive wages, '.repeat(4)
    const description = metaDescription(long)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description.length).toBeGreaterThanOrEqual(120)
    expect(description.endsWith('…')).toBe(true)
    expect(description).not.toMatch(/\s…$/)
  })

  it('falls back to the next candidate when one is empty', () => {
    expect(metaDescription('', '   ', 'Second choice')).toBe('Second choice')
  })
})

describe('canonical paths and JSON-LD', () => {
  it('drops the query, hash and trailing slash', () => {
    expect(canonicalPath('/jobs/123/?src=digest#apply')).toBe('/jobs/123')
    expect(canonicalPath('/')).toBe('/')
  })

  it('cannot close its script tag', () => {
    expect(jsonLd({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>')
  })
})

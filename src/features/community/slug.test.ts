import { describe, expect, it } from 'vitest'
import { groupSlugFromName, uniqueGroupSlug } from './slug'

describe('group slugs', () => {
  it('derives a lower-case ascii slug from the name', () => {
    expect(groupSlugFromName('Masters & Senior Officers')).toBe('masters-and-senior-officers')
    expect(groupSlugFromName('  Tanker  Professionals! ')).toBe('tanker-professionals')
    expect(groupSlugFromName('Café des Marins')).toBe('cafe-des-marins')
    expect(groupSlugFromName('***')).toBe('group')
  })

  it('keeps the slug within 80 characters', () => {
    const slug = groupSlugFromName('a'.repeat(70) + ' ' + 'b'.repeat(30))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('adds a numeric suffix when the slug is taken', () => {
    expect(uniqueGroupSlug('marine-engineers', [])).toBe('marine-engineers')
    expect(uniqueGroupSlug('marine-engineers', ['marine-engineers'])).toBe('marine-engineers-2')
    expect(uniqueGroupSlug('marine-engineers', ['marine-engineers', 'marine-engineers-2'])).toBe('marine-engineers-3')
    const long = 'x'.repeat(80)
    expect(uniqueGroupSlug(long, [long])).toHaveLength(80)
    expect(uniqueGroupSlug(long, [long])).toMatch(/-2$/)
  })
})

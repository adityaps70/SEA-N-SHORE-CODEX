import { describe, expect, it } from 'vitest'
import { activeHashtagQuery, extractHashtags, findHashtags, hashtagHref, isStorableHashtag, normaliseHashtag } from './parse'

describe('findHashtags', () => {
  it('finds tags at the start, after spaces and after brackets', () => {
    expect(findHashtags('#SIRE2 checks (#tanker) and\n#Vetting').map((m) => m.tag)).toEqual(['sire2', 'tanker', 'vetting'])
  })

  it('reports positions that point at the "#"', () => {
    const [match] = findHashtags('Hello #Maritime world')
    expect(match).toEqual({ raw: 'Maritime', tag: 'maritime', start: 6, end: 15 })
  })

  it('ignores "#" inside URLs, emails and identifiers', () => {
    expect(findHashtags('see https://example.com/page#top and mail me@ship.com#x or C#')).toEqual([])
    expect(findHashtags('price#1 is fine')).toEqual([])
  })

  it('ignores pure numbers and empty tags', () => {
    expect(findHashtags('#1 and # and #2024')).toEqual([])
    expect(findHashtags('#covid19').map((m) => m.tag)).toEqual(['covid19'])
  })

  it('stops at punctuation', () => {
    expect(findHashtags('#safety, #crew. #vessel!').map((m) => m.tag)).toEqual(['safety', 'crew', 'vessel'])
  })

  it('keeps underscores and drops tags longer than 64 characters', () => {
    expect(findHashtags('#life_at_sea').map((m) => m.tag)).toEqual(['life_at_sea'])
    expect(findHashtags(`#${'a'.repeat(65)}`)).toEqual([])
  })
})

describe('extractHashtags', () => {
  it('returns unique lower-case tags in order of first appearance', () => {
    expect(extractHashtags('#Tanker #tanker #SIRE #Tanker #sire')).toEqual(['tanker', 'sire'])
  })

  it('drops tags that cannot be stored (non-ASCII) and caps the count', () => {
    expect(extractHashtags('#naïve #ok')).toEqual(['ok'])
    expect(extractHashtags(Array.from({ length: 40 }, (_, i) => `#t${i}`).join(' '))).toHaveLength(30)
  })
})

describe('helpers', () => {
  it('normalises and validates tags', () => {
    expect(normaliseHashtag('##Hello ')).toBe('hello')
    expect(isStorableHashtag('ok_1')).toBe(true)
    expect(isStorableHashtag('')).toBe(false)
    expect(isStorableHashtag('bad-tag')).toBe(false)
  })

  it('links to the hashtag page', () => {
    expect(hashtagHref('#Tanker')).toBe('/hashtags/tanker')
  })

  it('finds the tag under the caret while typing', () => {
    expect(activeHashtagQuery('hello #sir', 10)).toEqual({ query: 'sir', start: 6 })
    expect(activeHashtagQuery('hello #sir', 7)).toEqual({ query: '', start: 6 })
    expect(activeHashtagQuery('hello #sir done', 15)).toBeNull()
    expect(activeHashtagQuery('url.com/a#top', 13)).toBeNull()
    expect(activeHashtagQuery('no tags', 7)).toBeNull()
  })
})

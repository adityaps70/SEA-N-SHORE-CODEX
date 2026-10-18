import { describe, expect, it } from 'vitest'
import { searchSql, searchTerms } from './search-repository'
import { SEARCH_WEIGHTS } from './search-weights'

describe('search rank tier (round H, H7)', () => {
  it('keeps the rank synonym alone for the rank tier ("chief eng", "C/E"), and nothing for a vessel or a name', () => {
    expect(searchTerms('chief eng').rankQuery).toBe('rkchiefengineer')
    expect(searchTerms('C/E').rankQuery).toBe('rkchiefengineer')
    expect(searchTerms('VLCC').rankQuery).toBe('')
    expect(searchTerms('Placeholder Member').rankQuery).toBe('')
  })

  it('puts a rank or title match above full text plus every people boost and popularity', () => {
    const W = SEARCH_WEIGHTS
    const bestFullText = W.tiers.fullText + W.fullTextScale + W.boosts.connection + W.boosts.secondDegree + W.boosts.verified + W.boosts.recentlyActive + W.popularityCap
    expect(W.tiers.rank).toBeGreaterThan(bestFullText)
  })

  it('references the rank parameters in every statement variant, so the parameter count never changes', () => {
    for (const fuzzy of [true, false]) {
      for (const fullText of [true, false]) {
        const sql = searchSql({ fuzzy, fullText })
        expect(sql).toContain('$21::text')
        expect(sql).toContain('$22::real')
      }
    }
    expect(searchSql({ fuzzy: false, fullText: true })).toContain('order by tier desc')
  })
})

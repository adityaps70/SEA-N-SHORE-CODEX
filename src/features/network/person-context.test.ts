import { describe, expect, it } from 'vitest'
import { personContextParts } from './person-context'

describe('personContextParts (round H, H7)', () => {
  it('leaves out the rank when the headline equals or contains it', () => {
    expect(personContextParts({ headline: 'Chief Engineer', rank: 'Chief Engineer', currentCompany: 'Ocean Example', location: 'Mumbai' }))
      .toEqual(['Ocean Example', 'Mumbai'])
    expect(personContextParts({ headline: 'chief engineer | LNG carriers', rank: 'Chief  Engineer', currentCompany: null, location: null })).toEqual([])
    expect(personContextParts({ headline: 'Chief Engineer at Ocean Example', rank: 'Chief Engineer', currentCompany: 'Ocean Example', location: 'Kochi' })).toEqual(['Kochi'])
  })

  it('matches whole words only', () => {
    expect(personContextParts({ headline: 'Marine Engineering lecturer', rank: 'Engineer' }, ['rank'])).toEqual(['Engineer'])
    expect(personContextParts({ headline: 'Master Mariner | Tanker Operations', rank: 'Master' }, ['rank'])).toEqual([])
  })

  it('keeps the rank when the headline says something else, or there is no headline', () => {
    expect(personContextParts({ headline: 'Tanker operations specialist', rank: 'Master', currentCompany: 'Ocean Example' })).toEqual(['Master', 'Ocean Example'])
    expect(personContextParts({ headline: null, rank: 'Master', currentCompany: 'Ocean Example', location: 'Goa' })).toEqual(['Master', 'Ocean Example', 'Goa'])
  })

  it('picks the requested fields and never repeats a value', () => {
    expect(personContextParts({ headline: '', rank: 'Master', currentCompany: 'Master', location: 'Goa' }, ['rank', 'currentCompany'])).toEqual(['Master'])
  })
})

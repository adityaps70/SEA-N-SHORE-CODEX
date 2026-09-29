import { describe, expect, it } from 'vitest'
import { suggestedGroupSlugs } from './suggestions'

describe('group suggestions', () => {
  it('always falls back to Ask the Community', () => {
    expect(suggestedGroupSlugs({ rank: null, vesselTypes: [], persona: null })).toEqual(['ask-the-community'])
  })

  it('suggests Marine Engineers for engineering ranks', () => {
    expect(suggestedGroupSlugs({ rank: 'Second Engineer', vesselTypes: [], persona: 'seafarer' })).toEqual(['marine-engineers', 'ask-the-community'])
    expect(suggestedGroupSlugs({ rank: 'Electro-Technical Engineer', vesselTypes: [], persona: null })[0]).toBe('marine-engineers')
  })

  it('suggests Masters & Senior Officers for command and deck-officer ranks', () => {
    for (const rank of ['Master', 'Captain', 'Chief Officer', '2nd Officer', 'Second Officer', 'Third Officer']) {
      expect(suggestedGroupSlugs({ rank, vesselTypes: [], persona: null }), rank).toContain('masters-senior-officers')
    }
    expect(suggestedGroupSlugs({ rank: 'Able Seaman', vesselTypes: [], persona: null })).not.toContain('masters-senior-officers')
  })

  it('suggests Tanker Professionals from vessel types and Cadets Community from the persona', () => {
    expect(suggestedGroupSlugs({ rank: 'Chief Officer', vesselTypes: ['Crude oil tanker', 'LNG carrier'], persona: null }))
      .toEqual(['masters-senior-officers', 'tanker-professionals', 'ask-the-community'])
    expect(suggestedGroupSlugs({ rank: null, vesselTypes: [], persona: 'student_cadet' })).toEqual(['cadets-community', 'ask-the-community'])
    expect(suggestedGroupSlugs({ rank: 'Deck Cadet', vesselTypes: [], persona: 'seafarer' })).toEqual(['cadets-community', 'ask-the-community'])
  })

  it('leaves out groups the member already belongs to and never repeats a slug', () => {
    expect(suggestedGroupSlugs({ rank: 'Chief Engineer', vesselTypes: ['Product tanker'], persona: null }, ['marine-engineers', 'ask-the-community']))
      .toEqual(['tanker-professionals'])
  })
})

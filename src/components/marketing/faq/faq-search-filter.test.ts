import { describe, expect, it } from 'vitest'
import { faqGroups } from './faq-data'
import { faqItemMatches, faqQueryTerms, searchFaqGroups } from './faq-search-filter'

describe('FAQ search filter (round H, H7)', () => {
  it('keeps every question for an empty query', () => {
    const groups = faqGroups()
    const total = groups.reduce((sum, group) => sum + group.items.length, 0)
    expect(searchFaqGroups(groups, '   ').total).toBe(total)
  })

  it('matches every word, in the question or the answer, ignoring case and accents', () => {
    const item = { id: 'x', question: 'How do I reset my password?', answer: 'Choose Forgot password? on the sign-in page and enter the code.' }
    expect(faqItemMatches(item, faqQueryTerms('PASSWORD code'))).toBe(true)
    expect(faqItemMatches(item, faqQueryTerms('pässword'))).toBe(true)
    expect(faqItemMatches(item, faqQueryTerms('password refund'))).toBe(false)
  })

  it('finds the new account answers and nothing for nonsense', () => {
    const groups = faqGroups()
    const twoStep = searchFaqGroups(groups, 'two-step verification')
    expect(twoStep.groups.flatMap((group) => group.items.map((item) => item.id))).toContain('lost-two-step-device')
    expect(searchFaqGroups(groups, 'zzqxv').total).toBe(0)
  })
})

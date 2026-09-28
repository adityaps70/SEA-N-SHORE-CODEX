import { describe, expect, it } from 'vitest'
import { faqGroups, faqJsonLd, jsonLdScript, landingFaqs } from './faq-data'

describe('FAQ data', () => {
  it('has the five help groups with unique question ids', () => {
    const groups = faqGroups()
    expect(groups.map((group) => group.title)).toEqual([
      'Seafarers & shore professionals',
      'Companies & organizations',
      'Courses & events',
      'Payments & plans',
      'Account & privacy',
    ])
    const ids = groups.flatMap((group) => group.items.map((item) => item.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of groups.flatMap((group) => group.items)) {
      expect(item.question.endsWith('?')).toBe(true)
      expect(item.answer.length).toBeGreaterThan(40)
    }
  })

  it('picks 8–10 questions for the landing page', () => {
    const items = landingFaqs()
    expect(items.length).toBeGreaterThanOrEqual(8)
    expect(items.length).toBeLessThanOrEqual(10)
    expect(items[0].question).toBe('Is Sea N Shore free?')
  })

  it('states the plan prices, auto-renewal and verification rules', () => {
    const text = faqGroups().flatMap((group) => group.items.map((item) => item.answer)).join('\n')
    expect(text).toContain('₹100 a month or ₹1,000 a year')
    expect(text).toContain('₹2,000 a month or ₹20,000 a year')
    expect(text).toContain('Cashfree')
    expect(text).toContain('cancel auto-renew at any time')
    expect(text).toContain('reviews and verifies every organization before its page is published')
    expect(text).toContain('info@beaufortmarine.in')
    expect(text).toContain('DG format')
  })

  it('only mentions Google sign-in when it is enabled', () => {
    const answer = (googleEnabled: boolean) =>
      faqGroups({ googleEnabled }).flatMap((group) => group.items).find((item) => item.id === 'sign-in')?.answer ?? ''
    expect(answer(true)).toContain('Google')
    expect(answer(false)).not.toContain('Google')
    expect(answer(false)).toContain('mobile number')
  })

  it('builds FAQPage structured data that cannot break out of its script tag', () => {
    const data = faqJsonLd([{ id: 'x', question: 'Q?', answer: 'Use </script> safely' }])
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'Use </script> safely' } }],
    })
    const json = jsonLdScript(data)
    expect(json).not.toContain('</script>')
    expect(JSON.parse(json)).toEqual(data)
  })
})

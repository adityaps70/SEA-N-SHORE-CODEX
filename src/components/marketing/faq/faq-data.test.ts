import { describe, expect, it } from 'vitest'
import { faqGroups, faqJsonLd, jsonLdScript, landingFaqs } from './faq-data'

describe('FAQ data', () => {
  it('has the seven help groups with unique question ids', () => {
    const groups = faqGroups()
    expect(groups.map((group) => group.title)).toEqual([
      'Joining Sea N Shore',
      'Seafarers & shore professionals',
      'Companies & organizations',
      'Global partners',
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

  it('states the plan prices, free trials, auto-renewal and verification rules from the price list', () => {
    const text = faqGroups().flatMap((group) => group.items.map((item) => item.answer)).join('\n')
    expect(text).toContain('₹99 a month or ₹999 a year')
    expect(text).toContain('₹1,999 a month, ₹10,000 for 6 months or ₹14,999 a year')
    expect(text).toContain('first 3 months are free')
    expect(text).toContain('first 2 months are free')
    expect(text).not.toContain('₹100 a month')
    expect(text).not.toContain('lifetime')
    expect(text).toContain('Cashfree')
    expect(text).toContain('cancel auto-renew at any time')
    expect(text).toContain('reviews and approves every organization before its page is published')
    expect(text).toContain('info@beaufortmarine.in')
    expect(text).toContain('DG format')
  })

  it('answers the joining, company, hiring and global-partner questions for this site’s real flows', () => {
    const items = faqGroups().flatMap((group) => group.items)
    const byId = (id: string) => items.find((item) => item.id === id)
    expect(byId('who-can-join')?.answer).toContain('Seafarer, Shore Professional, Recruiter / HR, Trainer / Instructor, Student / Cadet, Seafarer Family, Maritime Enthusiast or Other')
    expect(byId('register-seafarer')?.answer).toContain('check your spam or junk folder')
    expect(byId('register-seafarer')?.answer).toContain('Maritime Passport')
    expect(byId('why-join')?.answer).toContain('no middlemen')
    expect(byId('register-company')?.answer).toContain('Register a new organization')
    expect(byId('register-company')?.answer).toContain('Sea N Shore team reviews and approves')
    expect(byId('why-register-company')?.answer).toMatch(/^Registering is free/)
    expect(byId('why-register-company')?.answer).toContain('Organization Pro adds')
    expect(byId('post-job')?.answer).toContain('Hiring and choose Post a job')
    expect(byId('post-job')?.answer).toContain('one vacancy per job')
    expect(byId('find-seafarers')?.answer).toContain('My Network')
    expect(byId('find-seafarers')?.answer).toContain('Hiring → Applicants')
    expect(byId('global-partner')?.answer).toContain('like-minded companies to represent the Sea N Shore global community in their countries')
    expect(byId('global-partner')?.answer).toContain('"Global partnership"')
    expect(byId('global-partner')?.link).toEqual({ href: '/contact', label: 'Contact us about a global partnership' })
    expect(byId('global-partner-benefits')?.answer).toContain('Global visibility for your company across the Sea N Shore community, bringing you more business')
    expect(items.some((item) => /mentor/i.test(item.question))).toBe(false)
  })

  it('only mentions Google sign-in when it is enabled, and never mobile-number sign-in', () => {
    const answer = (googleEnabled: boolean) =>
      faqGroups({ googleEnabled }).flatMap((group) => group.items).find((item) => item.id === 'sign-in')?.answer ?? ''
    expect(answer(true)).toContain('Google')
    expect(answer(false)).not.toContain('Google')
    expect(answer(false)).not.toContain('mobile number')
    expect(answer(false)).toContain('spam or junk folder')
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

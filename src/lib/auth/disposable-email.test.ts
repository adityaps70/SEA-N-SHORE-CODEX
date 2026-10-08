import { describe, expect, it } from 'vitest'
import { DISPOSABLE_EMAIL_DOMAINS, emailDomain, isDisposableEmail, isDisposableEmailDomain } from './disposable-email'

describe('disposable email domains (Round 14, 2.7)', () => {
  it('is a curated, sorted, duplicate-free list of lower-case domains', () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.length).toBeGreaterThanOrEqual(150)
    expect(DISPOSABLE_EMAIL_DOMAINS.length).toBeLessThanOrEqual(300)
    expect(new Set(DISPOSABLE_EMAIL_DOMAINS).size).toBe(DISPOSABLE_EMAIL_DOMAINS.length)
    expect([...DISPOSABLE_EMAIL_DOMAINS].sort()).toEqual(DISPOSABLE_EMAIL_DOMAINS)
    for (const domain of DISPOSABLE_EMAIL_DOMAINS) expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
  })

  it.each([
    'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'temp-mail.org',
    'yopmail.com', 'trashmail.com', 'trashmail.de', 'sharklasers.com', 'getnada.com', 'dispostable.com',
    'maildrop.cc', 'tempmail.com', 'tempmail.net',
  ])('includes the well-known disposable domain %s', (domain) => {
    expect(DISPOSABLE_EMAIL_DOMAINS).toContain(domain)
  })

  it('matches the domain and its subdomains, case-insensitively', () => {
    expect(isDisposableEmail('someone@mailinator.com')).toBe(true)
    expect(isDisposableEmail('Someone@MailInator.COM')).toBe(true)
    expect(isDisposableEmail('someone@eu.inbox.mailinator.com')).toBe(true)
    expect(isDisposableEmail(' someone@yopmail.fr ')).toBe(true)
    expect(isDisposableEmail('someone@mailinator.com.')).toBe(true)
    expect(isDisposableEmailDomain('SHARKLASERS.COM')).toBe(true)
  })

  it('does not match look-alike or unrelated domains', () => {
    expect(isDisposableEmail('someone@notmailinator.com')).toBe(false)
    expect(isDisposableEmail('someone@mailinator.com.example.org')).toBe(false)
    expect(isDisposableEmail('someone@gmail.com')).toBe(false)
    expect(isDisposableEmail('someone@outlook.com')).toBe(false)
    expect(isDisposableEmail('someone@seanshore.in')).toBe(false)
    expect(isDisposableEmailDomain('com')).toBe(false)
  })

  it('never blocks phone-only members\' synthetic addresses', () => {
    expect(isDisposableEmail('phone-0123456789abcdef@auth.seaandshore.in')).toBe(false)
  })

  it('ignores values that are not addresses', () => {
    expect(isDisposableEmail('mailinator.com')).toBe(false)
    expect(isDisposableEmail('')).toBe(false)
    expect(isDisposableEmail(undefined)).toBe(false)
    expect(isDisposableEmail(42)).toBe(false)
    expect(emailDomain('a@')).toBeNull()
  })

  it('is identical to the copy embedded in the Cognito pre-sign-up Lambda', async () => {
    const lambda = await import('../../../infra/aws/app/lambda/cognito-pre-sign-up-link.mjs')
    expect([...lambda.DISPOSABLE_EMAIL_DOMAINS]).toEqual([...DISPOSABLE_EMAIL_DOMAINS])
    for (const value of ['a@mailinator.com', 'a@X.Trashmail.DE', 'a@gmail.com', 'phone-1@auth.seaandshore.in', 'nope']) {
      expect(lambda.isDisposableEmail(value)).toBe(isDisposableEmail(value))
    }
  })
})

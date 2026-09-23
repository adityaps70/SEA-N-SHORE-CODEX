import { describe, expect, it } from 'vitest'
import { assessPlatformText, moderationBlockMessage } from './automated'

describe('automated content moderation', () => {
  it('allows ordinary maritime professional content', () => {
    const result = assessPlatformText([
      'Chief Engineer required for an LPG carrier.',
      'Valid STCW certificates and tanker experience required. Joining in Singapore.',
    ])

    expect(result.decision).toBe('allow')
    expect(result.reason).toBeNull()
    expect(result.ruleIds).toEqual([])
  })

  it('blocks direct threats and violent harassment', () => {
    const result = assessPlatformText(['I will kill you when I see you at the port.'])

    expect(result.decision).toBe('block')
    expect(result.category).toBe('threats_harassment')
    expect(result.reason).toBe('harassment')
    expect(result.ruleIds).toContain('direct_violence_threat')
  })

  it('sends abusive harassment for administrator review', () => {
    const result = assessPlatformText(['You are a useless idiot and should never work on a ship.'])

    expect(result.decision).toBe('review')
    expect(result.category).toBe('abusive_content')
    expect(result.reason).toBe('harassment')
  })

  it('blocks explicit hate incitement', () => {
    const result = assessPlatformText(['All Muslims should be attacked and driven out.'])

    expect(result.decision).toBe('block')
    expect(result.category).toBe('hate_unsafe')
    expect(result.reason).toBe('hate_or_abuse')
    expect(result.ruleIds).toContain('hate_violence_incitation')
  })

  it('flags recruitment-fee scam patterns for review', () => {
    const result = assessPlatformText([
      'Guaranteed job. Pay the registration fee now and contact us on WhatsApp for immediate joining.',
    ])

    expect(result.decision).toBe('review')
    expect(result.category).toBe('spam_scams')
    expect(result.reason).toBe('scam')
    expect(result.ruleIds).toContain('recruitment_fee_scam')
  })

  it('blocks credential theft requests', () => {
    const result = assessPlatformText(['Send your OTP and password to verify your account immediately.'])

    expect(result.decision).toBe('block')
    expect(result.category).toBe('spam_scams')
    expect(result.reason).toBe('scam')
    expect(result.ruleIds).toContain('credential_theft')
  })

  it('flags maritime credential fraud as another platform-rule violation', () => {
    const result = assessPlatformText(['Buy a COC without exam and get fake sea service documents.'])

    expect(result.decision).toBe('review')
    expect(result.category).toBe('platform_rule_violation')
    expect(result.reason).toBe('other')
    expect(result.ruleIds).toContain('credential_fraud')
  })

  it('flags repeated promotional links as spam without blocking normal single links', () => {
    expect(assessPlatformText(['Read the guidance at https://example.com once.']).decision).toBe('allow')

    const result = assessPlatformText([
      'Apply now https://spam.example/a https://spam.example/b https://spam.example/c',
    ])
    expect(result.decision).toBe('review')
    expect(result.reason).toBe('spam')
    expect(result.ruleIds).toContain('repeated_links')
  })

  it('uses neutral user-facing copy for blocked submissions', () => {
    expect(moderationBlockMessage()).toMatch(/community safety rules/i)
    expect(moderationBlockMessage()).not.toMatch(/kill|hate|scam/i)
  })
})

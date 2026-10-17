import { describe, expect, it } from 'vitest'
import {
  aboutPageSchema,
  grievanceOfficerSchema,
  hasGrievanceOfficer,
  isSiteSettingKey,
  parseSiteSetting,
  SITE_IMAGE_PATH,
  SITE_SETTING_DEFAULTS,
} from './schemas'

const IMAGE = 'site/about/11111111-1111-4111-8111-111111111111.png'

describe('site setting schemas (round H, H7)', () => {
  it('starts empty: no officer, no founders, team, partners or numbers', () => {
    expect(SITE_SETTING_DEFAULTS.grievance_officer).toEqual({ name: '', email: '', responseTime: '' })
    expect(hasGrievanceOfficer(SITE_SETTING_DEFAULTS.grievance_officer)).toBe(false)
    expect(SITE_SETTING_DEFAULTS.about_page).toMatchObject({ founders: [], team: [], partners: [], memberNumbers: { enabled: false } })
  })

  it('needs both a name and an email for the Grievance Officer, or neither', () => {
    expect(grievanceOfficerSchema.safeParse({ name: '', email: '', responseTime: '' }).success).toBe(true)
    const named = grievanceOfficerSchema.parse({ name: ' Placeholder Officer ', email: 'Officer@Example.com ', responseTime: 'Within 15 days' })
    expect(named).toEqual({ name: 'Placeholder Officer', email: 'officer@example.com', responseTime: 'Within 15 days' })
    expect(hasGrievanceOfficer(named)).toBe(true)
    const onlyName = grievanceOfficerSchema.safeParse({ name: 'Placeholder Officer', email: '', responseTime: '' })
    expect(onlyName.success).toBe(false)
    expect(onlyName.error?.issues[0]).toMatchObject({ path: ['email'] })
    expect(grievanceOfficerSchema.safeParse({ name: 'Placeholder Officer', email: 'not-an-email', responseTime: '' }).success).toBe(false)
    expect(grievanceOfficerSchema.safeParse({ name: '', email: '', responseTime: 'Within 15 days' }).success).toBe(false)
  })

  it('accepts About page people and partners with uploaded images and safe links only', () => {
    const parsed = aboutPageSchema.parse({
      founders: [{ name: 'Placeholder Founder', role: 'Founder', bio: '', photoPath: IMAGE, profileUrl: '/people/placeholder' }],
      partners: [{ name: 'Placeholder Partner', logoPath: '', websiteUrl: 'https://example.com' }],
    })
    expect(parsed.founders[0]).toMatchObject({ photoPath: IMAGE, profileUrl: '/people/placeholder' })
    expect(parsed.partners[0]).toMatchObject({ logoPath: null, websiteUrl: 'https://example.com' })
    expect(parsed.team).toEqual([])
    expect(parsed.memberNumbers.enabled).toBe(false)

    for (const bad of [
      { founders: [{ name: '' }] },
      { founders: [{ name: 'Placeholder', photoPath: 'profiles/x/avatar.png' }] },
      { founders: [{ name: 'Placeholder', profileUrl: 'javascript:alert(1)' }] },
      { founders: [{ name: 'Placeholder', profileUrl: '//evil.example' }] },
      { partners: [{ name: 'Placeholder', websiteUrl: 'http://example.com' }] },
      { partners: Array.from({ length: 25 }, (_, index) => ({ name: `Placeholder ${index}` })) },
    ]) {
      expect(aboutPageSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false)
    }
  })

  it('reads anything invalid as the default and knows its keys', () => {
    expect(parseSiteSetting('about_page', { founders: 'nope' })).toEqual(SITE_SETTING_DEFAULTS.about_page)
    expect(parseSiteSetting('grievance_officer', undefined)).toEqual(SITE_SETTING_DEFAULTS.grievance_officer)
    expect(isSiteSettingKey('about_page')).toBe(true)
    expect(isSiteSettingKey('payments')).toBe(false)
    expect(SITE_IMAGE_PATH.test(IMAGE)).toBe(true)
    expect(SITE_IMAGE_PATH.test('site/about/../secret.png')).toBe(false)
  })
})

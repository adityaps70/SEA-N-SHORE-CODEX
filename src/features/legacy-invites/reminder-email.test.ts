import { describe, expect, it } from 'vitest'
import { legacyFirstName, legacyReminderEmail } from './reminder-email'

const INPUT = {
  fullName: 'Asha Rao',
  email: 'asha@example.com',
  claimToken: '11111111-1111-4111-8111-111111111111',
  unsubscribeToken: '22222222-2222-4222-8222-222222222222',
  siteUrl: 'https://seanshore.in',
}

const CLAIM = 'https://seanshore.in/auth/claim-profile?invite=11111111-1111-4111-8111-111111111111'
const UNSUBSCRIBE = 'https://seanshore.in/email/legacy/unsubscribe?token=22222222-2222-4222-8222-222222222222'

describe('legacy second reminder email', () => {
  it('uses the approved subject, preheader and wording, word for word, in the plain-text version', () => {
    const email = legacyReminderEmail(INPUT)
    expect(email.subject).toBe('Reminder: your Sea N Shore profile is waiting')
    expect(email.preheader).toBe('One minute to reclaim your old seaandshore.in account.')
    expect(email.text).toBe([
      'Hi Asha,',
      '',
      'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.',
      '',
      `Reclaim my Sea N Shore profile: ${CLAIM}`,
      '',
      "It takes about a minute: sign in with asha@example.com or with Google, confirm it's you, and your profile is yours again.",
      '',
      "If you've already joined with a different email, you can ignore this message.",
      '',
      `This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe: ${UNSUBSCRIBE}`,
      '',
      '—',
      'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
      "You're receiving this because you had an account on seaandshore.in.",
    ].join('\n'))
  })

  it('has the same words in HTML, with the preheader, the button, the claim link and the unsubscribe link', () => {
    const { html } = legacyReminderEmail(INPUT)
    const visible = html.replace(/<[^>]+>/g, ' ').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
    for (const sentence of [
      'One minute to reclaim your old seaandshore.in account.',
      'Hi Asha,',
      'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.',
      'Reclaim my Sea N Shore profile',
      "It takes about a minute: sign in with asha@example.com or with Google, confirm it's you, and your profile is yours again.",
      "If you've already joined with a different email, you can ignore this message.",
      "This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe",
      'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
      "You're receiving this because you had an account on seaandshore.in.",
    ]) expect(visible).toContain(sentence)
    expect(html).toContain(`href="${CLAIM}"`)
    expect(html).toContain(`href="${UNSUBSCRIBE}"`)
  })

  it('has no images, tracking pixels or promotions', () => {
    const { html, text } = legacyReminderEmail(INPUT)
    expect(html).not.toMatch(/<img|background-image|url\(/i)
    expect(html.match(/href="/g)).toHaveLength(2)
    for (const word of ['jobs', 'learning', 'newsletter', 'offer', 'discount', 'free']) {
      expect(text.toLowerCase()).not.toContain(word)
    }
  })

  it('offers RFC 8058 one-click unsubscribe in the headers', () => {
    expect(legacyReminderEmail(INPUT).headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://seanshore.in/api/email/legacy/unsubscribe?token=22222222-2222-4222-8222-222222222222>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('escapes the name and email in HTML', () => {
    const { html } = legacyReminderEmail({ ...INPUT, fullName: '<b>Bad</b>', email: 'a"b@example.com' })
    expect(html).not.toContain('<b>Bad')
    expect(html).toContain('a&quot;b@example.com')
  })

  it('greets by first name, skipping titles, and falls back to "there"', () => {
    expect(legacyFirstName('Capt. Asha Rao')).toBe('Asha')
    expect(legacyFirstName('Captain Ravi Kumar')).toBe('Ravi')
    expect(legacyFirstName('Mr Deepak')).toBe('Deepak')
    expect(legacyFirstName("D'Souza")).toBe("D'Souza")
    expect(legacyFirstName('  ')).toBe('there')
    expect(legacyFirstName('Capt.')).toBe('there')
  })
})

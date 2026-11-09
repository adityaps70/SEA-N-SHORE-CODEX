import { describe, expect, it } from 'vitest'
import { legacyFinalReminderEmail, legacyFinalReminderOffer, legacyFinalReminderTestEmail } from './final-reminder-email'
import { legacyReminderEmail } from './reminder-email'

const COUNTS = { openJobs: 1234, courses: 1, upcomingEvents: 7 }
const INPUT = {
  fullName: 'Capt. Asha Rao',
  email: 'asha@example.com',
  clickToken: '33333333-3333-4333-8333-333333333333',
  unsubscribeToken: '22222222-2222-4222-8222-222222222222',
  counts: COUNTS,
  siteUrl: 'https://seanshore.in',
}

const CLICK = 'https://seanshore.in/api/email/legacy/final/claim?t=33333333-3333-4333-8333-333333333333'
const UNSUBSCRIBE = 'https://seanshore.in/email/legacy/unsubscribe?token=22222222-2222-4222-8222-222222222222'
const ONE_CLICK = 'https://seanshore.in/api/email/legacy/unsubscribe?token=22222222-2222-4222-8222-222222222222'

function visible(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/\s+/g, ' ')
}

describe('final legacy reminder email', () => {
  it('has the exact subject and the full plain-text wording', () => {
    const email = legacyFinalReminderEmail(INPUT)
    expect(email.subject).toBe('Last reminder: your Sea N Shore profile is still waiting')
    expect(email.text).toBe([
      'Your Sea N Shore profile is still waiting',
      '',
      'Hi Asha,',
      '',
      'Your profile from the old Sea N Shore website is still saved. This is the last email we will send about it.',
      '',
      'We said our last email would be the final one, but your profile is still waiting, so here is one last note.',
      '',
      "What's on Sea N Shore now:",
      '- Verified jobs: 1,234 open right now',
      '- Courses and certificates: 1 course open to join',
      '- Events: 7 upcoming',
      '- The maritime community of seafarers and shore professionals',
      '',
      `Reclaim my Sea N Shore profile: ${CLICK}`,
      '',
      "Sign in with asha@example.com or with Google, confirm it's you, and your profile is yours again.",
      '',
      `Don't email me about this again: ${UNSUBSCRIBE}`,
      '',
      '—',
      'Need help? WhatsApp +91 85914 63321 (https://wa.me/918591463321) or email info@beaufortmarine.in',
      'Instagram: https://www.instagram.com/seaandshore.in',
      'Facebook: https://www.facebook.com/seaandshore.in',
      'X: https://x.com/inseaandshore',
      'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
      "You're receiving this because you had an account on seaandshore.in.",
    ].join('\n'))
  })

  it('renders the required sentences, live counts and links into the branded HTML', () => {
    const { html } = legacyFinalReminderEmail(INPUT)
    const text = visible(html)
    for (const sentence of [
      'Last reminder: your Sea N Shore profile is still waiting',
      'Hi Asha,',
      'Your profile from the old Sea N Shore website is still saved. This is the last email we will send about it.',
      'We said our last email would be the final one, but your profile is still waiting, so here is one last note.',
      'Verified jobs : 1,234 open right now',
      'Courses and certificates : 1 course open to join',
      'Events : 7 upcoming',
      'The maritime community of seafarers and shore professionals',
      'Reclaim my Sea N Shore profile',
      "Don't email me about this again",
      'Need help? WhatsApp +91 85914 63321 or email info@beaufortmarine.in',
    ]) expect(text).toContain(sentence)
    expect(html).toContain(`href="${CLICK}"`)
    expect(html).toContain(`href="${UNSUBSCRIBE}"`)
    expect(html).toContain('href="https://wa.me/918591463321"')
    expect(html).toContain('href="mailto:info@beaufortmarine.in"')
    expect(html).toContain('<strong>asha@example.com</strong>')
  })

  it('has the one-click unsubscribe headers', () => {
    expect(legacyFinalReminderEmail(INPUT).headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<${ONE_CLICK}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('goes to the claim link only through the click redirect, and has no tracking pixel: the logo is the only image', () => {
    const { html, text } = legacyFinalReminderEmail(INPUT)
    expect(html).not.toContain('/auth/claim-profile')
    expect(text).not.toContain('/auth/claim-profile')
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])
    expect(images).toHaveLength(1)
    expect(images[0]).toContain('src="https://seanshore.in/brand/email/sea-n-shore-logo.png"')
    expect(html).not.toMatch(/background(-image)?\s*:\s*url\(/i)
    expect(html).not.toMatch(/<(script|link|style|iframe)\b/i)
    expect(html).not.toMatch(/width="1"|height="1"/)
  })

  it('names an item without a number when its count is 0 or could not be read', () => {
    const email = legacyFinalReminderEmail({ ...INPUT, counts: { openJobs: null, courses: null, upcomingEvents: null } })
    expect(email.text).toContain('- Verified jobs for seafarers and shore professionals')
    expect(email.text).toContain('- Courses and certificates to grow your career')
    expect(email.text).toContain('- Events for the maritime industry')
    const offer = email.text.slice(email.text.indexOf("What's on"), email.text.indexOf('Reclaim'))
    expect(offer).not.toMatch(/\d/)
    expect(legacyFinalReminderOffer({ openJobs: 2, courses: 3, upcomingEvents: 1 }).map(([label, rest]) => `${label}${rest}`)).toEqual([
      'Verified jobs: 2 open right now',
      'Courses and certificates: 3 courses open to join',
      'Events: 1 upcoming',
      'The maritime community of seafarers and shore professionals',
    ])
  })

  it('makes no deadline or deletion threat, and differs from the second reminder', () => {
    const email = legacyFinalReminderEmail(INPUT)
    expect(email.text).not.toMatch(/delete|deleted|removed|expire|deadline|before \d|within \d|days left|last chance/i)
    const second = legacyReminderEmail({ fullName: INPUT.fullName, email: INPUT.email, claimToken: '11111111-1111-4111-8111-111111111111', unsubscribeToken: INPUT.unsubscribeToken, siteUrl: INPUT.siteUrl })
    expect(email.subject).not.toBe(second.subject)
    expect(email.html).not.toBe(second.html)
  })

  it('escapes the name and the email in the HTML', () => {
    const { html } = legacyFinalReminderEmail({ ...INPUT, fullName: '<b>Eve</b>', email: 'eve"<x>@example.com' })
    expect(html).not.toContain('<b>Eve</b>')
    expect(html).toContain('eve&quot;&lt;x&gt;@example.com')
  })

  it('the test email is the same email with [TEST], the sample person and links that change nothing', () => {
    const test = legacyFinalReminderTestEmail({ counts: COUNTS, siteUrl: 'https://seanshore.in' })
    expect(test.subject).toBe('[TEST] Last reminder: your Sea N Shore profile is still waiting')
    expect(test.text).toContain('Reclaim my Sea N Shore profile: https://seanshore.in/email/legacy/test-link')
    expect(test.text).not.toMatch(/claim\?t=|token=|invite=/)
    expect(test.headers[0]).toEqual({ Name: 'List-Unsubscribe', Value: '<https://seanshore.in/api/email/legacy/test-unsubscribe>' })
    expect(test.text).toContain('Verified jobs: 1,234 open right now')
  })
})

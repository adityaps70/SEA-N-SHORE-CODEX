import { describe, expect, it } from 'vitest'
import { LEGACY_REMINDER_LOGO_URL, legacyFirstName, legacyReminderEmail, legacyReminderTestEmail } from './reminder-email'

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
  it('keeps the approved subject and preheader, and the plain text has the full wording, help lines and footer', () => {
    const email = legacyReminderEmail(INPUT)
    expect(email.subject).toBe('Reminder: your Sea N Shore profile is waiting')
    expect(email.preheader).toBe('One minute to reclaim your old seaandshore.in account.')
    expect(email.text).toBe([
      'Your Sea N Shore profile is waiting',
      '',
      'Hi Asha,',
      '',
      'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.',
      '',
      `Reclaim my Sea N Shore profile: ${CLAIM}`,
      '',
      "It takes about a minute: sign in with asha@example.com or with Google, confirm it's you, and your profile is yours again.",
      '',
      "Having trouble signing in? Message us on WhatsApp at +91 85914 63321 (https://wa.me/918591463321) and we'll help you.",
      '',
      "If you've already joined with a different email, you can ignore this message.",
      '',
      "What's on Sea N Shore now: Jobs matched to your rank · Courses with verified certificates · Your network of seafarers and shore professionals",
      '',
      `This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe: ${UNSUBSCRIBE}`,
      '',
      '—',
      'Instagram: https://www.instagram.com/seaandshore.in',
      'Facebook: https://www.facebook.com/seaandshore.in',
      'X: https://x.com/inseaandshore',
      'Need help? WhatsApp +91 85914 63321 (https://wa.me/918591463321) or email info@beaufortmarine.in',
      'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
      "You're receiving this because you had an account on seaandshore.in.",
    ].join('\n'))
  })

  it('has the claim link and the unsubscribe link in the plain-text version', () => {
    const { text } = legacyReminderEmail(INPUT)
    expect(text).toContain(CLAIM)
    expect(text).toContain(UNSUBSCRIBE)
  })

  it('renders every variable into the branded HTML: first name, email, claim link and unsubscribe link', () => {
    const { html } = legacyReminderEmail(INPUT)
    const visible = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
    for (const sentence of [
      'One minute to reclaim your old seaandshore.in account.',
      'Your Sea N Shore profile is waiting',
      'Hi Asha,',
      'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in , and your old profile is ready for you to reclaim.',
      'Reclaim my Sea N Shore profile',
      "It takes about a minute: sign in with asha@example.com or with Google, confirm it's you, and your profile is yours again.",
      "Having trouble signing in? Message us on WhatsApp at +91 85914 63321 and we'll help you.",
      "If you've already joined with a different email, you can ignore this message.",
      "What's on Sea N Shore now",
      'Jobs matched to your rank · Courses with verified certificates · Your network of seafarers and shore professionals',
      "This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe .",
      'Need help? WhatsApp +91 85914 63321 or email info@beaufortmarine.in',
      'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
      "You're receiving this because you had an account on seaandshore.in.",
    ]) expect(visible).toContain(sentence)
    expect(html).toContain('<strong>asha@example.com</strong>')
    expect(html).toContain(`href="${CLAIM}"`)
    expect(html).toContain(`href="${UNSUBSCRIBE}"`)
    expect(html).not.toMatch(/Rahul|rahul@example\.com|EXAMPLE/)
  })

  it('links only the claim, unsubscribe, site, WhatsApp, social and contact addresses', () => {
    const { html } = legacyReminderEmail(INPUT)
    expect([...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'))).toEqual([
      'https://seanshore.in',
      CLAIM,
      'https://wa.me/918591463321',
      UNSUBSCRIBE,
      'https://www.instagram.com/seaandshore.in',
      'https://www.facebook.com/seaandshore.in',
      'https://x.com/inseaandshore',
      'https://wa.me/918591463321',
      'mailto:info@beaufortmarine.in',
    ])
  })

  it('has the logo as its only image, and no tracking pixels, scripts, external CSS or web fonts', () => {
    const { html } = legacyReminderEmail(INPUT)
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])
    expect(images).toHaveLength(1)
    expect(images[0]).toContain('src="https://seanshore.in/brand/email/sea-n-shore-logo.png"')
    expect(images[0]).toContain('width="180"')
    expect(images[0]).toContain('alt="Sea N Shore"')
    expect([...html.matchAll(/\bsrc="([^"]*)"/g)].map((match) => match[1])).toEqual([LEGACY_REMINDER_LOGO_URL])
    expect(html).not.toMatch(/background(?:-image)?\s*[:=][^;"]*url\(|url\(|<script|<link|<style|@import|@font-face|fonts\.googleapis|javascript:|<iframe|<object|<embed|<video|<audio|<picture|<source|srcset|\son[a-z]+=/i)
  })

  it('is email-safe: table layout, 600px max width and a bulletproof button', () => {
    const { html } = legacyReminderEmail(INPUT)
    expect(html).toContain('max-width:600px')
    expect(html).toMatch(/<td align="center" bgcolor="#075E82" style="border-radius:8px;">\s*<a href="https:\/\/seanshore\.in\/auth\/claim-profile\?invite=/)
    expect(html).not.toMatch(/<(?:div|p|h1)[^>]*style="[^"]*(?:display:\s*flex|display:\s*grid|position:)/i)
    for (const colour of ['#075E82', '#0B2233', '#102532', '#EEF3F6']) expect(html).toContain(colour)
  })

  it('offers RFC 8058 one-click unsubscribe in both headers', () => {
    expect(legacyReminderEmail(INPUT).headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://seanshore.in/api/email/legacy/unsubscribe?token=22222222-2222-4222-8222-222222222222>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })

  it('escapes every variable in HTML', () => {
    const { html } = legacyReminderEmail({
      ...INPUT,
      fullName: '<b>Bad</b>',
      email: 'a"b<i>@example.com',
      claimToken: 'x"><script>1</script>',
      unsubscribeToken: 'y" onclick="z',
    })
    expect(html).not.toContain('<b>Bad')
    expect(html).not.toContain('<i>')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/\sonclick=/)
    expect(html).toContain('<strong>a&quot;b&lt;i&gt;@example.com</strong>')
    expect(html).toContain('href="https://seanshore.in/email/legacy/unsubscribe?token=y%22%20onclick%3D%22z"')
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

describe('legacy second reminder test email', () => {
  const real = legacyReminderEmail({ ...INPUT, fullName: 'Test Admin', email: 'test.admin@example.com' })
  const test = legacyReminderTestEmail({ siteUrl: 'https://seanshore.in' })
  const swap = (value: string) => value
    .replaceAll(CLAIM, 'https://seanshore.in/email/legacy/test-link')
    .replaceAll(UNSUBSCRIBE, 'https://seanshore.in/email/legacy/test-link?link=unsubscribe')

  it('is the exact reminder with sample details and "[TEST] " before the subject', () => {
    expect(test.subject).toBe('[TEST] Reminder: your Sea N Shore profile is waiting')
    expect(test.preheader).toBe(real.preheader)
    expect(test.html).toBe(swap(real.html))
    expect(test.text).toBe(swap(real.text))
    expect(test.html).toContain('Hi Test,')
    expect(test.html).toContain('<strong>test.admin@example.com</strong>')
  })

  it('has links that cannot claim a profile or unsubscribe anyone, and keeps both unsubscribe headers', () => {
    expect(`${test.html}\n${test.text}`).not.toMatch(/claim-profile|invite=|token=|\/api\/email\/legacy\/unsubscribe/)
    expect(test.claimUrl).toBe('https://seanshore.in/email/legacy/test-link')
    expect(test.unsubscribeUrl).toBe('https://seanshore.in/email/legacy/test-link?link=unsubscribe')
    expect(test.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://seanshore.in/api/email/legacy/test-unsubscribe>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })
})

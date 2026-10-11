import { escapeHtml, legacyClaimUrl, legacySiteUrl } from './email'

export const LEGACY_REMINDER_SUBJECT = 'Reminder: your Sea N Shore profile is waiting'
export const LEGACY_REMINDER_PREHEADER = 'One minute to reclaim your old seaandshore.in account.'

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'capt', 'captain', 'cdr', 'lt', 'eng', 'er', 'prof', 'shri', 'smt'])

/** First name for the greeting: the first word of the profile name that is not a title ("Capt. Asha Rao" → "Asha"). */
export function legacyFirstName(fullName: string) {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  const first = words.find((word) => !TITLES.has(word.toLowerCase().replace(/\.+$/, '')))
  const name = first?.replace(/[^\p{L}\p{M}'’-]/gu, '') ?? ''
  return name || 'there'
}

export function legacyUnsubscribeLinks(siteUrl: string, unsubscribeToken: string) {
  const base = legacySiteUrl(siteUrl)
  const token = encodeURIComponent(unsubscribeToken)
  return {
    page: `${base}/email/legacy/unsubscribe?token=${token}`,
    oneClick: `${base}/api/email/legacy/unsubscribe?token=${token}`,
  }
}

/** The only image in the reminder: a white-background PNG (WebP does not show in Outlook), shown at 180px wide. */
export const LEGACY_REMINDER_LOGO_URL = 'https://seanshore.in/brand/email/sea-n-shore-logo.png'
export const LEGACY_REMINDER_WHATSAPP = { label: '+91 85914 63321', url: 'https://wa.me/918591463321' }
export const LEGACY_REMINDER_CONTACT_EMAIL = 'info@beaufortmarine.in'
export const LEGACY_REMINDER_SOCIAL = [
  { label: 'Instagram', url: 'https://www.instagram.com/seaandshore.in' },
  { label: 'Facebook', url: 'https://www.facebook.com/seaandshore.in' },
  { label: 'X', url: 'https://x.com/inseaandshore' },
] as const

const HEADING = 'Your Sea N Shore profile is waiting'

/**
 * The one and only second reminder for a legacy seaandshore.in account, in the owner's branded design (11 October).
 * Same unique claim link as the first invitation. Email-safe HTML: tables, inline styles, a bulletproof button, no
 * external CSS, web fonts, scripts or tracking pixels; the logo is the only image. RFC 8058 one-click unsubscribe in
 * the headers plus a link in the body; either puts the address on the do-not-email list.
 */
export function legacyReminderEmail(input: { fullName: string; email: string; claimToken: string; unsubscribeToken: string; siteUrl?: string }) {
  const siteUrl = legacySiteUrl(input.siteUrl)
  return renderLegacyReminder({
    subject: LEGACY_REMINDER_SUBJECT,
    fullName: input.fullName,
    email: input.email,
    claimUrl: legacyClaimUrl(siteUrl, input.claimToken),
    unsubscribe: legacyUnsubscribeLinks(siteUrl, input.unsubscribeToken),
  })
}

/** The sample person shown in a test reminder. */
export const LEGACY_REMINDER_TEST_SAMPLE = { fullName: 'Test Admin', email: 'test.admin@example.com' } as const

/** Where a test reminder's links go: a page that says it is a test, and a one-click endpoint that changes nothing. */
export function legacyReminderTestLinks(siteUrl?: string) {
  const base = legacySiteUrl(siteUrl)
  return {
    claim: `${base}/email/legacy/test-link`,
    page: `${base}/email/legacy/test-link?link=unsubscribe`,
    oneClick: `${base}/api/email/legacy/test-unsubscribe`,
  }
}

/**
 * The exact second reminder, for an admin's "Send test to me": the same HTML, text and headers, with the sample
 * person, "[TEST] " before the subject, and links that change nothing (no claim token, no unsubscribe token).
 */
export function legacyReminderTestEmail(input: { siteUrl?: string } = {}) {
  const links = legacyReminderTestLinks(input.siteUrl)
  return renderLegacyReminder({
    subject: `[TEST] ${LEGACY_REMINDER_SUBJECT}`,
    fullName: LEGACY_REMINDER_TEST_SAMPLE.fullName,
    email: LEGACY_REMINDER_TEST_SAMPLE.email,
    claimUrl: links.claim,
    unsubscribe: { page: links.page, oneClick: links.oneClick },
  })
}

function renderLegacyReminder(input: { subject: string; fullName: string; email: string; claimUrl: string; unsubscribe: { page: string; oneClick: string } }) {
  const { claimUrl, unsubscribe } = input
  const firstName = legacyFirstName(input.fullName)
  const whatsapp = LEGACY_REMINDER_WHATSAPP

  const text = [
    HEADING,
    '',
    `Hi ${firstName},`,
    '',
    'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.',
    '',
    `Reclaim my Sea N Shore profile: ${claimUrl}`,
    '',
    `It takes about a minute: sign in with ${input.email} or with Google, confirm it's you, and your profile is yours again.`,
    '',
    `Having trouble signing in? Message us on WhatsApp at ${whatsapp.label} (${whatsapp.url}) and we'll help you.`,
    '',
    "If you've already joined with a different email, you can ignore this message.",
    '',
    "What's on Sea N Shore now: Jobs matched to your rank · Courses with verified certificates · Your network of seafarers and shore professionals",
    '',
    `This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe: ${unsubscribe.page}`,
    '',
    '—',
    ...LEGACY_REMINDER_SOCIAL.map((social) => `${social.label}: ${social.url}`),
    `Need help? WhatsApp ${whatsapp.label} (${whatsapp.url}) or email ${LEGACY_REMINDER_CONTACT_EMAIL}`,
    'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
    "You're receiving this because you had an account on seaandshore.in.",
  ].join('\n')

  const link = (href: string, label: string, style: string) => `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`
  const socialLinks = LEGACY_REMINDER_SOCIAL.map((social) => link(social.url, social.label, 'color:#FFFFFF;text-decoration:none;font-weight:bold;'))
    .join('<span style="color:#5E7686;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(LEGACY_REMINDER_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#EEF3F6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EEF3F6;mso-hide:all;">${escapeHtml(LEGACY_REMINDER_PREHEADER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF3F6;">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#102532;">
        <tr><td style="height:5px;background:#075E82;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td align="center" style="padding:28px 32px 8px;">
            <img src="${LEGACY_REMINDER_LOGO_URL}" width="180" alt="Sea N Shore" style="display:block;width:180px;max-width:60%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 4px;">
            <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:bold;color:#0B2233;">${HEADING}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 0;font-size:16px;line-height:25px;color:#102532;">
            <p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>
            <p style="margin:0 0 14px;">You had an account on seaandshore.in. That site has moved to Sea N Shore at <a href="https://seanshore.in" style="color:#075E82;text-decoration:underline;">seanshore.in</a>, and your old profile is ready for you to reclaim.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:10px 32px 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="#075E82" style="border-radius:8px;">
                  <a href="${escapeHtml(claimUrl)}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">Reclaim my Sea N Shore profile</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px;font-size:16px;line-height:25px;color:#102532;">
            <p style="margin:0 0 14px;">It takes about a minute: sign in with <strong>${escapeHtml(input.email)}</strong> or with Google, confirm it's you, and your profile is yours again.</p>
            <p style="margin:0 0 14px;">Having trouble signing in? Message us on WhatsApp at ${link(whatsapp.url, whatsapp.label, 'color:#075E82;font-weight:bold;text-decoration:underline;')} and we'll help you.</p>
            <p style="margin:0 0 4px;color:#4A5D6B;font-size:15px;">If you've already joined with a different email, you can ignore this message.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F7FA;border-radius:10px;">
              <tr>
                <td style="padding:16px 18px 6px;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#075E82;">What's on Sea N Shore now</td>
              </tr>
              <tr>
                <td style="padding:0 18px 16px;font-size:15px;line-height:23px;color:#102532;">
                  <strong>Jobs</strong> matched to your rank&nbsp;&nbsp;·&nbsp;&nbsp;<strong>Courses</strong> with verified certificates&nbsp;&nbsp;·&nbsp;&nbsp;<strong>Your network</strong> of seafarers and shore professionals
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 26px;font-size:14px;line-height:22px;color:#4A5D6B;">
            This is the last reminder we'll send about your old account. Don't want emails from us? <a href="${escapeHtml(unsubscribe.page)}" style="color:#4A5D6B;text-decoration:underline;">Unsubscribe</a>.
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 26px;background:#0B2233;color:#C9D6DF;font-size:13px;line-height:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-bottom:12px;">${socialLinks}</td>
              </tr>
              <tr>
                <td style="padding-bottom:8px;color:#C9D6DF;">Need help? WhatsApp ${link(whatsapp.url, whatsapp.label, 'color:#FFFFFF;text-decoration:underline;')} or email ${link(`mailto:${LEGACY_REMINDER_CONTACT_EMAIL}`, LEGACY_REMINDER_CONTACT_EMAIL, 'color:#FFFFFF;text-decoration:underline;')}</td>
              </tr>
              <tr>
                <td style="color:#8FA4B2;font-size:12px;line-height:18px;">
                  Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai<br>
                  You're receiving this because you had an account on seaandshore.in.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

  return {
    subject: input.subject,
    preheader: LEGACY_REMINDER_PREHEADER,
    text,
    html,
    claimUrl,
    unsubscribeUrl: unsubscribe.page,
    headers: [
      { Name: 'List-Unsubscribe', Value: `<${unsubscribe.oneClick}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
  }
}

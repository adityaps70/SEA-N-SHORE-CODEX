import { escapeHtml, legacySiteUrl } from './email'
import type { LegacyLiveCounts } from './live-counts'
import {
  LEGACY_REMINDER_CONTACT_EMAIL,
  LEGACY_REMINDER_LOGO_URL,
  LEGACY_REMINDER_SOCIAL,
  LEGACY_REMINDER_WHATSAPP,
  legacyFirstName,
  legacyReminderTestLinks,
  legacyUnsubscribeLinks,
} from './reminder-email'

export const LEGACY_FINAL_REMINDER_SUBJECT = 'Last reminder: your Sea N Shore profile is still waiting'
export const LEGACY_FINAL_REMINDER_PREHEADER = 'This is the last email we will send about your old Sea N Shore profile.'
export const LEGACY_FINAL_REMINDER_SAVED = 'Your profile from the old Sea N Shore website is still saved. This is the last email we will send about it.'
export const LEGACY_FINAL_REMINDER_HONEST = 'We said our last email would be the final one, but your profile is still waiting, so here is one last note.'
export const LEGACY_FINAL_REMINDER_CTA = 'Reclaim my Sea N Shore profile'
export const LEGACY_FINAL_REMINDER_STOP = "Don't email me about this again"

const HEADING = 'Your Sea N Shore profile is still waiting'

/** The claim button's link: our own click-tracking redirect, which then opens the same claim link as before. */
export function legacyFinalClaimClickUrl(siteUrl: string | undefined, clickToken: string) {
  return `${legacySiteUrl(siteUrl)}/api/email/legacy/final/claim?t=${encodeURIComponent(clickToken)}`
}

function formatCount(value: number) {
  return value.toLocaleString('en-IN')
}

/**
 * What is on Sea N Shore now, with live counts. An item whose count is missing (0 or unreadable) has no number.
 * Each item: [bold label, rest of the line].
 */
export function legacyFinalReminderOffer(counts: LegacyLiveCounts): Array<[string, string]> {
  const { openJobs, courses, upcomingEvents } = counts
  return [
    openJobs
      ? ['Verified jobs', `: ${formatCount(openJobs)} open right now`]
      : ['Verified jobs', ' for seafarers and shore professionals'],
    courses
      ? ['Courses and certificates', `: ${formatCount(courses)} ${courses === 1 ? 'course' : 'courses'} open to join`]
      : ['Courses and certificates', ' to grow your career'],
    upcomingEvents
      ? ['Events', `: ${formatCount(upcomingEvents)} upcoming`]
      : ['Events', ' for the maritime industry'],
    ['The maritime community', ' of seafarers and shore professionals'],
  ]
}

type RenderInput = {
  subject: string
  fullName: string
  email: string
  claimHref: string
  unsubscribe: { page: string; oneClick: string }
  counts: LegacyLiveCounts
}

/**
 * The final legacy reminder: the last email about an old seaandshore.in account, and the last legacy email of all.
 * Short and honest: no deadline, no deletion threat. Email-safe HTML in the same branded design as the second
 * reminder (tables, inline styles, a bulletproof button, the logo PNG as the only image, no tracking pixel). The
 * button goes through our click-tracking redirect to the same claim link as the first invitation. RFC 8058 one-click
 * unsubscribe in the headers plus a link in the body; either puts the address on the do-not-email list.
 */
export function legacyFinalReminderEmail(input: {
  fullName: string
  email: string
  clickToken: string
  unsubscribeToken: string
  counts: LegacyLiveCounts
  siteUrl?: string
}) {
  const siteUrl = legacySiteUrl(input.siteUrl)
  return renderLegacyFinalReminder({
    subject: LEGACY_FINAL_REMINDER_SUBJECT,
    fullName: input.fullName,
    email: input.email,
    claimHref: legacyFinalClaimClickUrl(siteUrl, input.clickToken),
    unsubscribe: legacyUnsubscribeLinks(siteUrl, input.unsubscribeToken),
    counts: input.counts,
  })
}

/** The sample person in a test final reminder. */
export const LEGACY_FINAL_REMINDER_TEST_SAMPLE = { fullName: 'Test Admin', email: 'test.admin@example.com' } as const

/**
 * The exact final reminder, for an admin's "Send test to me": the same HTML, text and headers, with the sample person,
 * live counts, "[TEST] " before the subject, and links that change nothing (no click, claim or unsubscribe token).
 */
export function legacyFinalReminderTestEmail(input: { counts: LegacyLiveCounts; siteUrl?: string }) {
  const links = legacyReminderTestLinks(input.siteUrl)
  return renderLegacyFinalReminder({
    subject: `[TEST] ${LEGACY_FINAL_REMINDER_SUBJECT}`,
    fullName: LEGACY_FINAL_REMINDER_TEST_SAMPLE.fullName,
    email: LEGACY_FINAL_REMINDER_TEST_SAMPLE.email,
    claimHref: links.claim,
    unsubscribe: { page: links.page, oneClick: links.oneClick },
    counts: input.counts,
  })
}

function renderLegacyFinalReminder(input: RenderInput) {
  const { claimHref, unsubscribe } = input
  const firstName = legacyFirstName(input.fullName)
  const whatsapp = LEGACY_REMINDER_WHATSAPP
  const offer = legacyFinalReminderOffer(input.counts)

  const text = [
    HEADING,
    '',
    `Hi ${firstName},`,
    '',
    LEGACY_FINAL_REMINDER_SAVED,
    '',
    LEGACY_FINAL_REMINDER_HONEST,
    '',
    "What's on Sea N Shore now:",
    ...offer.map(([label, rest]) => `- ${label}${rest}`),
    '',
    `${LEGACY_FINAL_REMINDER_CTA}: ${claimHref}`,
    '',
    `Sign in with ${input.email} or with Google, confirm it's you, and your profile is yours again.`,
    '',
    `${LEGACY_FINAL_REMINDER_STOP}: ${unsubscribe.page}`,
    '',
    '—',
    `Need help? WhatsApp ${whatsapp.label} (${whatsapp.url}) or email ${LEGACY_REMINDER_CONTACT_EMAIL}`,
    ...LEGACY_REMINDER_SOCIAL.map((social) => `${social.label}: ${social.url}`),
    'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
    "You're receiving this because you had an account on seaandshore.in.",
  ].join('\n')

  const link = (href: string, label: string, style: string) => `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`
  const socialLinks = LEGACY_REMINDER_SOCIAL.map((social) => link(social.url, social.label, 'color:#FFFFFF;text-decoration:none;font-weight:bold;'))
    .join('<span style="color:#5E7686;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>')
  const offerRows = offer.map(([label, rest]) => `
              <tr>
                <td valign="top" style="padding:0 0 10px 18px;width:14px;font-size:15px;line-height:23px;color:#075E82;font-weight:bold;">&#8226;</td>
                <td style="padding:0 18px 10px 6px;font-size:15px;line-height:23px;color:#102532;"><strong>${escapeHtml(label)}</strong>${escapeHtml(rest)}</td>
              </tr>`).join('')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(LEGACY_FINAL_REMINDER_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F1EC;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F3F1EC;mso-hide:all;">${escapeHtml(LEGACY_FINAL_REMINDER_PREHEADER)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F1EC;">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#102532;">
        <tr>
          <td align="left" style="padding:26px 32px 6px;">
            <img src="${LEGACY_REMINDER_LOGO_URL}" width="150" alt="Sea N Shore" style="display:block;width:150px;max-width:50%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:14px 32px 0;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#9A5B13;">Last reminder</p>
            <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:bold;color:#0B2233;">${HEADING}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 32px 0;font-size:16px;line-height:25px;color:#102532;">
            <p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)},</p>
            <p style="margin:0 0 14px;">${escapeHtml(LEGACY_FINAL_REMINDER_SAVED)}</p>
            <p style="margin:0 0 6px;color:#4A5D6B;">${escapeHtml(LEGACY_FINAL_REMINDER_HONEST)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F5F0;border-left:4px solid #075E82;border-radius:6px;">
              <tr>
                <td colspan="2" style="padding:14px 18px 10px;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#075E82;">What's on Sea N Shore now</td>
              </tr>${offerRows}
              <tr><td colspan="2" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 32px 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="#075E82" style="border-radius:8px;">
                  <a href="${escapeHtml(claimHref)}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">${LEGACY_FINAL_REMINDER_CTA}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 32px 0;font-size:15px;line-height:23px;color:#4A5D6B;" align="center">
            Sign in with <strong>${escapeHtml(input.email)}</strong> or with Google, confirm it's you, and your profile is yours again.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 32px 24px;font-size:14px;line-height:22px;">
            <a href="${escapeHtml(unsubscribe.page)}" style="color:#4A5D6B;text-decoration:underline;">${escapeHtml(LEGACY_FINAL_REMINDER_STOP)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 26px;background:#0B2233;color:#C9D6DF;font-size:13px;line-height:20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-bottom:10px;color:#C9D6DF;">Need help? WhatsApp ${link(whatsapp.url, whatsapp.label, 'color:#FFFFFF;text-decoration:underline;')} or email ${link(`mailto:${LEGACY_REMINDER_CONTACT_EMAIL}`, LEGACY_REMINDER_CONTACT_EMAIL, 'color:#FFFFFF;text-decoration:underline;')}</td>
              </tr>
              <tr>
                <td style="padding-bottom:12px;">${socialLinks}</td>
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
    preheader: LEGACY_FINAL_REMINDER_PREHEADER,
    text,
    html,
    claimHref,
    unsubscribeUrl: unsubscribe.page,
    headers: [
      { Name: 'List-Unsubscribe', Value: `<${unsubscribe.oneClick}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
  }
}

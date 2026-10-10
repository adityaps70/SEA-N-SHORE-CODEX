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

/**
 * The one and only second reminder for a legacy seaandshore.in account. Same unique claim link as the first
 * invitation. No promotions, images or tracking pixels. RFC 8058 one-click unsubscribe in the headers plus a link
 * in the body; either puts the address on the do-not-email list.
 */
export function legacyReminderEmail(input: { fullName: string; email: string; claimToken: string; unsubscribeToken: string; siteUrl?: string }) {
  const siteUrl = legacySiteUrl(input.siteUrl)
  const claimUrl = legacyClaimUrl(siteUrl, input.claimToken)
  const unsubscribe = legacyUnsubscribeLinks(siteUrl, input.unsubscribeToken)
  const firstName = legacyFirstName(input.fullName)

  const text = [
    `Hi ${firstName},`,
    '',
    'You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.',
    '',
    `Reclaim my Sea N Shore profile: ${claimUrl}`,
    '',
    `It takes about a minute: sign in with ${input.email} or with Google, confirm it's you, and your profile is yours again.`,
    '',
    "If you've already joined with a different email, you can ignore this message.",
    '',
    `This is the last reminder we'll send about your old account. Don't want emails from us? Unsubscribe: ${unsubscribe.page}`,
    '',
    '—',
    'Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai',
    "You're receiving this because you had an account on seaandshore.in.",
  ].join('\n')

  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6'
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#ffffff;font-family:Arial,sans-serif;color:#123047">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(LEGACY_REMINDER_PREHEADER)}</div>
    <div style="max-width:600px;margin:0 auto;padding:28px 18px">
      <p style="${p}">Hi ${escapeHtml(firstName)},</p>
      <p style="${p}">You had an account on seaandshore.in. That site has moved to Sea N Shore at seanshore.in, and your old profile is ready for you to reclaim.</p>
      <p style="margin:24px 0"><a href="${escapeHtml(claimUrl)}" style="display:inline-block;background:#08789e;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px">Reclaim my Sea N Shore profile</a></p>
      <p style="${p}">It takes about a minute: sign in with ${escapeHtml(input.email)} or with Google, confirm it&#039;s you, and your profile is yours again.</p>
      <p style="${p}">If you&#039;ve already joined with a different email, you can ignore this message.</p>
      <p style="${p}">This is the last reminder we&#039;ll send about your old account. Don&#039;t want emails from us? <a href="${escapeHtml(unsubscribe.page)}" style="color:#08789e">Unsubscribe</a></p>
      <p style="margin:24px 0 8px;font-size:13px;line-height:1.6;color:#667987">—</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#667987">Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#667987">You&#039;re receiving this because you had an account on seaandshore.in.</p>
    </div>
  </body>
</html>`

  return {
    subject: LEGACY_REMINDER_SUBJECT,
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

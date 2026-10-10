import { learningNotificationCopy } from './learning-notification-copy'
import type { LearningNotificationDetails, LearningNotificationKind } from './learning-notifications'

/**
 * The learning notification email (learning round A, A6): one short message, one button and an
 * unsubscribe footer. The unsubscribe link carries the email's own queue id: it is random, names
 * no person, and only ever turns learning emails off for the person it was sent to.
 */

export const LEARNING_EMAIL_FROM = 'Sea N Shore Learning <learning@mail.seanshore.in>'

export function learningEmailSiteUrl(siteUrl?: string) {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || 'https://seanshore.in').trim().replace(/\/+$/, '')
}

export function learningUnsubscribeLinks(siteUrl: string, emailId: string) {
  const token = encodeURIComponent(emailId)
  return {
    page: `${siteUrl}/email/learning/unsubscribe?token=${token}`,
    oneClick: `${siteUrl}/api/email/learning/unsubscribe?token=${token}`,
    settings: `${siteUrl}/settings/notifications`,
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function learningEmail(input: {
  emailId: string
  kind: LearningNotificationKind
  details: LearningNotificationDetails
  siteUrl?: string
}) {
  const siteUrl = learningEmailSiteUrl(input.siteUrl)
  const copy = learningNotificationCopy(input.kind, input.details)
  const url = `${siteUrl}${copy.path}`
  const links = learningUnsubscribeLinks(siteUrl, input.emailId)
  const footer = 'You get this email because you learn or teach on Sea N Shore.'
  const text = [
    copy.message,
    ...(copy.detail ? [copy.detail] : []),
    `${copy.action}: ${url}`,
    `${footer} Turn off learning emails: ${links.page}`,
    `Or choose your emails in Settings: ${links.settings}`,
  ].join('\n\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 20px;font-size:16px;line-height:1.6">${escapeHtml(copy.message)}</p>
${copy.detail ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;white-space:pre-wrap;border-left:3px solid #c9d8de;padding-left:12px;color:#334a57">${escapeHtml(copy.detail)}</p>\n` : ''}<p style="margin:0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${escapeHtml(copy.action)}</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">${escapeHtml(footer)} <a href="${escapeHtml(links.page)}" style="color:#607481">Turn off learning emails</a> · <a href="${escapeHtml(links.settings)}" style="color:#607481">Email settings</a></div>
</div></body></html>`
  return {
    subject: copy.subject,
    text,
    html,
    headers: [
      { Name: 'List-Unsubscribe', Value: `<${links.oneClick}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
  }
}

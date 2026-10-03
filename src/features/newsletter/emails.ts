import type { NewsletterConfig } from './config'
import { createNewsletterToken } from './tokens'
import { newsletterTopicLabel, type NewsletterTopic } from './topics'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function paragraphsHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('')
}

function layout(bodyHtml: string, footerHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">${bodyHtml}</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">${footerHtml}</div>
</div></body></html>`
}

export function unsubscribeLinks(config: NewsletterConfig, subscriberId: string, now?: Date) {
  if (!config.tokenSecret) throw new Error('newsletter_secret_missing')
  const token = createNewsletterToken({ subscriberId, purpose: 'unsubscribe', secret: config.tokenSecret, now })
  return {
    page: `${config.siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
    oneClick: `${config.siteUrl}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
  }
}

export function confirmationEmail(config: NewsletterConfig, input: { subscriberId: string; topics: NewsletterTopic[]; now?: Date }) {
  if (!config.tokenSecret) throw new Error('newsletter_secret_missing')
  const token = createNewsletterToken({ subscriberId: input.subscriberId, purpose: 'confirm', secret: config.tokenSecret, now: input.now })
  const confirmUrl = `${config.siteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`
  const topics = input.topics.map(newsletterTopicLabel).join(', ')
  const subject = 'Confirm your Sea N Shore newsletter subscription'
  const text = [
    'Please confirm that you want to receive the Sea N Shore newsletter.',
    `Topics: ${topics}`,
    `Confirm here: ${confirmUrl}`,
    'This link expires in 7 days. If you did not ask for this, ignore this email and you will not be subscribed.',
  ].join('\n\n')
  const html = layout(
    `<p style="margin:0 0 16px;font-size:18px;font-weight:bold">Confirm your subscription</p>
<p style="margin:0 0 16px;line-height:1.6">Please confirm that you want to receive the Sea N Shore newsletter.</p>
<p style="margin:0 0 16px;line-height:1.6"><strong>Topics:</strong> ${escapeHtml(topics)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Confirm subscription</a></p>
<p style="margin:0;line-height:1.6;color:#607481">This link expires in 7 days. If you did not ask for this, ignore this email and you will not be subscribed.</p>`,
    'You received this one-time email because this address was entered on the Sea N Shore newsletter form.',
  )
  return { subject, text, html }
}

export function campaignEmail(
  config: NewsletterConfig,
  input: { subscriberId: string; topic: NewsletterTopic; subject: string; bodyText: string; now?: Date },
) {
  const links = unsubscribeLinks(config, input.subscriberId, input.now)
  const reason = `You are receiving this because you subscribed to "${newsletterTopicLabel(input.topic)}" on Sea N Shore.`
  const postal = process.env.NEWSLETTER_POSTAL_ADDRESS?.trim()
  const text = [
    input.bodyText.trim(),
    '—',
    reason,
    `Unsubscribe: ${links.page}`,
    `Manage topics: ${config.siteUrl}/newsletter`,
    ...(postal ? [postal] : []),
  ].join('\n\n')
  const html = layout(
    paragraphsHtml(input.bodyText),
    `${escapeHtml(reason)}<br><a href="${escapeHtml(links.page)}" style="color:#075e82">Unsubscribe</a> · <a href="${escapeHtml(`${config.siteUrl}/newsletter`)}" style="color:#075e82">Manage topics</a>${postal ? `<br>${escapeHtml(postal)}` : ''}`,
  )

  // In "app" mode Sea N Shore provides the RFC 8058 one-click headers itself;
  // in "ses" mode SES subscription management adds them.
  const headers = config.listUnsubscribeMode === 'app'
    ? [
        { Name: 'List-Unsubscribe', Value: `<${links.oneClick}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ]
    : []

  return { subject: input.subject, text, html, headers }
}

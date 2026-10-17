import { SUPPORT_OPERATIONS_EMAIL, supportTicketReference, supportTopicLabel, supportTopicShortLabel } from './topics'

/**
 * Round H (H7): the three ticket emails. Plain and short; each names the ticket reference.
 * - operations_new_ticket / operations_member_reply: to the operations inbox, with the sender's name,
 *   address, topic and message, and a link to answer in Admin › Support (answers are written there, so
 *   every reply stays on the ticket).
 * - sender_admin_reply: to the address the sender gave. A signed-in member gets a link to the request
 *   under Help › My requests; a visitor, who has no account page, can reply to the email (it goes to the
 *   operations inbox).
 * Kept free of web-only imports: the outbox worker renders these.
 */
export const SUPPORT_EMAIL_FROM = 'Sea N Shore Support <support@mail.seanshore.in>'

export const SUPPORT_EMAIL_KINDS = ['operations_new_ticket', 'operations_member_reply', 'sender_admin_reply'] as const
export type SupportEmailKind = (typeof SUPPORT_EMAIL_KINDS)[number]

export type SupportEmailInput = {
  kind: SupportEmailKind
  ticketId: string
  topic: string
  senderName: string
  senderEmail: string
  signedIn: boolean
  body: string
  siteUrl: string
}

export type RenderedSupportEmail = { to: string; subject: string; text: string; html: string; replyTo?: string }

export function supportSiteUrl(siteUrl?: string) {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || 'https://seanshore.in').trim().replace(/\/+$/, '')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Header lines and the subject and link can never carry a line break from the form. */
function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 12px;line-height:1.6;white-space:pre-wrap">${escapeHtml(part.trim())}</p>`)
    .join('')
}

function frame(bodyHtml: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">${bodyHtml}</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">${escapeHtml(footer)}</div>
</div></body></html>`
}

function button(href: string, label: string) {
  return `<p style="margin:20px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0b5c7a;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:8px">${escapeHtml(label)}</a></p>`
}

export function renderSupportEmail(input: SupportEmailInput): RenderedSupportEmail {
  const reference = supportTicketReference(input.ticketId)
  const name = oneLine(input.senderName) || 'The sender'
  const email = oneLine(input.senderEmail)
  const topic = supportTopicLabel(input.topic)

  if (input.kind === 'sender_admin_reply') {
    const link = `${input.siteUrl}/help/requests/${input.ticketId}`
    const next = input.signedIn
      ? 'You can read the whole conversation and reply under Help › My requests.'
      : 'To answer, reply to this email.'
    const text = [
      `Hello ${name},`,
      '',
      `Sea N Shore support answered your request ${reference} (${topic}):`,
      '',
      input.body,
      '',
      next,
      ...(input.signedIn ? [link] : []),
      '',
      'Sea N Shore support',
    ].join('\n')
    const html = frame(
      `<p style="margin:0 0 12px">Hello ${escapeHtml(name)},</p>
<p style="margin:0 0 16px">Sea N Shore support answered your request <strong>${escapeHtml(reference)}</strong> (${escapeHtml(topic)}):</p>
<div style="border-left:3px solid #c9dde6;padding-left:12px;margin:0 0 16px">${paragraphs(input.body)}</div>
<p style="margin:0">${escapeHtml(next)}</p>${input.signedIn ? button(link, 'Open my request') : ''}`,
      `You get this email because you contacted Sea N Shore (${reference}).`,
    )
    return {
      to: email,
      subject: `Re: your Sea N Shore request ${reference}`,
      text,
      html,
      ...(input.signedIn ? {} : { replyTo: SUPPORT_OPERATIONS_EMAIL }),
    }
  }

  const link = `${input.siteUrl}/admin/support/${input.ticketId}`
  const isReply = input.kind === 'operations_member_reply'
  const who = `${name} <${email}>${input.signedIn ? ' (signed-in member)' : ' (visitor, not signed in)'}`
  const heading = isReply ? `New reply on ${reference}` : `New request ${reference}`
  const text = [
    heading,
    '',
    `From: ${who}`,
    `Topic: ${topic}`,
    '',
    input.body,
    '',
    `Answer in Admin › Support: ${link}`,
  ].join('\n')
  const html = frame(
    `<p style="margin:0 0 12px;font-weight:bold">${escapeHtml(heading)}</p>
<p style="margin:0 0 4px">From: ${escapeHtml(who)}</p>
<p style="margin:0 0 16px">Topic: ${escapeHtml(topic)}</p>
<div style="border-left:3px solid #c9dde6;padding-left:12px;margin:0 0 16px">${paragraphs(input.body)}</div>
<p style="margin:0">Answer in Admin › Support so the reply stays on the request.</p>${button(link, 'Answer in Admin')}`,
    'Sent to the Sea N Shore operations inbox for every Contact page request.',
  )
  return {
    to: SUPPORT_OPERATIONS_EMAIL,
    subject: `[${reference}] ${isReply ? 'Reply' : 'New request'}: ${supportTopicShortLabel(input.topic)}`,
    text,
    html,
  }
}

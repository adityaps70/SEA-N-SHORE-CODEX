import { NOTIFICATION_EMAIL_COPY, type ActivityNotificationType, type NotificationEmailKind } from './kinds'
import { DEFAULT_PUBLIC_SITE_URL } from '@/config/public-site'

/**
 * Round H (H3): the member activity emails. Same frame as the other transactional emails (brand line, one white
 * card, one button, a footer), plus a text part. Each email names only what the in-app notification already says:
 * the other member's name and what they did. Never a message, comment or post text, and never an email address.
 * The footer and the List-Unsubscribe headers (RFC 8058 one-click) turn off this email's type only.
 */
export const NOTIFICATION_EMAIL_FROM = 'Sea N Shore <notifications@mail.seanshore.in>'

export type RenderedNotificationEmail = {
  subject: string
  text: string
  html: string
  headers: Array<{ Name: string; Value: string }>
}

export function notificationEmailSiteUrl(siteUrl?: string) {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).trim().replace(/\/+$/, '')
}

export function notificationUnsubscribeLinks(siteUrl: string, token: string) {
  const encoded = encodeURIComponent(token)
  return {
    page: `${siteUrl}/email/notifications/unsubscribe?token=${encoded}`,
    oneClick: `${siteUrl}/api/email/notifications/unsubscribe?token=${encoded}`,
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

/** A member's display name, on one line and bounded, for subjects and copy. */
export function safeName(value: string | null | undefined) {
  const flat = (value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!flat) return 'A Sea N Shore member'
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

function frame(input: {
  siteUrl: string
  kind: NotificationEmailKind
  token: string
  subject: string
  lines: string[]
  action: { label: string; url: string }
  note?: string
}): RenderedNotificationEmail {
  const links = notificationUnsubscribeLinks(input.siteUrl, input.token)
  const turnOff = NOTIFICATION_EMAIL_COPY[input.kind].turnOff
  const footer = 'You get this email because of your email settings on Sea N Shore.'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.subject)}</title></head><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
${input.lines.map((line) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${escapeHtml(line)}</p>`).join('\n')}
${input.note ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334a57">${escapeHtml(input.note)}</p>\n` : ''}<p style="margin:4px 0 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${escapeHtml(input.action.label)}</a></p>
</div>
<div style="font-size:12px;color:#4f6472;padding:16px 4px;line-height:1.5">${escapeHtml(footer)} <a href="${escapeHtml(links.page)}" style="color:#4f6472">Turn off ${escapeHtml(turnOff)}</a> · <a href="${escapeHtml(links.settings)}" style="color:#4f6472">Email settings</a></div>
</div></body></html>`
  const text = [
    ...input.lines,
    ...(input.note ? [input.note] : []),
    `${input.action.label}: ${input.action.url}`,
    `${footer} Turn off ${turnOff}: ${links.page}`,
    `Or choose your emails in Settings: ${links.settings}`,
  ].join('\n\n')
  return {
    subject: input.subject,
    text,
    html,
    headers: [
      { Name: 'List-Unsubscribe', Value: `<${links.oneClick}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
  }
}

const ACTIVITY_COPY: Record<ActivityNotificationType, { kind: Exclude<NotificationEmailKind, 'messages'>; did: string; action: string }> = {
  connection_request: { kind: 'connection_requests', did: 'wants to connect with you on Sea N Shore', action: 'See the request' },
  post_comment: { kind: 'comments', did: 'commented on your post', action: 'View the comment' },
  comment_reply: { kind: 'comments', did: 'replied to your comment', action: 'View the reply' },
  post_mention: { kind: 'mentions', did: 'mentioned you in a post', action: 'View the post' },
  comment_mention: { kind: 'mentions', did: 'mentioned you in a comment', action: 'View the comment' },
  photo_tag: { kind: 'mentions', did: 'tagged you in a photo', action: 'View the photo' },
}

export function activityKindFor(type: ActivityNotificationType) {
  return ACTIVITY_COPY[type].kind
}

function activityPath(input: { type: ActivityNotificationType; postId: string | null; commentId: string | null }) {
  if (input.type === 'connection_request') return '/network?tab=requests'
  if (!input.postId) return '/notifications'
  const base = `/posts/${encodeURIComponent(input.postId)}`
  return input.commentId && input.type !== 'photo_tag' && input.type !== 'post_mention' ? `${base}#comment-${encodeURIComponent(input.commentId)}` : base
}

/** One email for one connection request, comment, reply, mention or photo tag. */
export function activityEmail(input: {
  type: ActivityNotificationType
  actorName: string | null
  postId: string | null
  commentId: string | null
  token: string
  siteUrl?: string
}): RenderedNotificationEmail {
  const siteUrl = notificationEmailSiteUrl(input.siteUrl)
  const copy = ACTIVITY_COPY[input.type]
  const name = safeName(input.actorName)
  return frame({
    siteUrl,
    kind: copy.kind,
    token: input.token,
    subject: `${name} ${copy.did}`,
    lines: [`${name} ${copy.did}.`],
    action: { label: copy.action, url: `${siteUrl}${activityPath(input)}` },
  })
}

function listNames(names: readonly string[], total: number) {
  const shown = names.slice(0, 3).map(safeName)
  const others = Math.max(0, total - shown.length)
  if (!shown.length) return ''
  if (others > 0) return `${shown.join(', ')} and ${others} other${others === 1 ? '' : 's'}`
  if (shown.length === 1) return shown[0]!
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/**
 * The hourly unread messages digest. Privacy: it says how many unread messages there are and who sent them, never
 * what they say. Messages are private, can be edited or deleted on Sea N Shore, and an email cannot be taken back.
 */
export function messageDigestEmail(input: {
  unreadCount: number
  conversationCount: number
  senderNames: readonly string[]
  senderCount: number
  token: string
  siteUrl?: string
}): RenderedNotificationEmail {
  const siteUrl = notificationEmailSiteUrl(input.siteUrl)
  const count = Math.max(1, Math.floor(input.unreadCount))
  const conversations = Math.max(1, Math.floor(input.conversationCount))
  const from = listNames(input.senderNames, Math.max(input.senderCount, input.senderNames.length))
  const messages = `${count} unread message${count === 1 ? '' : 's'}`
  const subject = `You have ${messages} on Sea N Shore`
  const line = from
    ? `You have ${messages}${conversations > 1 ? ` in ${conversations} conversations` : ''} from ${from}.`
    : `You have ${messages}${conversations > 1 ? ` in ${conversations} conversations` : ''}.`
  return frame({
    siteUrl,
    kind: 'messages',
    token: input.token,
    subject,
    lines: [line],
    note: 'For your privacy, message text is never included in emails. We send at most one of these an hour.',
    action: { label: 'Open Messages', url: `${siteUrl}/messages` },
  })
}

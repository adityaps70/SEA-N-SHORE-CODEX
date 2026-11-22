import type { JobAlertEmailPayload } from './job-alerts'
import { DEFAULT_PUBLIC_SITE_URL } from '@/config/public-site'

/**
 * Round G: the job alert email (G3) and the weekly digest email (G6). Plain, short, one button per
 * item, and an unsubscribe footer for that topic only. The unsubscribe token is the email's random
 * queue id. Emails name jobs, pages and posts the recipient can already open; never a member's
 * email address, and never anything the recipient could not see on the site.
 */
export const RANKING_EMAIL_TOPICS = ['job_alerts', 'weekly_digest'] as const
export type RankingEmailTopic = (typeof RANKING_EMAIL_TOPICS)[number]

export const RANKING_EMAIL_FROM: Record<RankingEmailTopic, string> = {
  job_alerts: 'Sea N Shore Jobs <jobs@mail.seanshore.in>',
  weekly_digest: 'Sea N Shore <digest@mail.seanshore.in>',
}

export const RANKING_EMAIL_TOPIC_LABELS: Record<RankingEmailTopic, string> = {
  job_alerts: 'job alert emails',
  weekly_digest: 'the weekly digest',
}

export function rankingEmailSiteUrl(siteUrl?: string) {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).trim().replace(/\/+$/, '')
}

export function rankingUnsubscribeLinks(siteUrl: string, emailId: string) {
  const token = encodeURIComponent(emailId)
  return {
    page: `${siteUrl}/email/unsubscribe?token=${token}`,
    oneClick: `${siteUrl}/api/email/unsubscribe?token=${token}`,
    settings: `${siteUrl}/settings/notifications`,
  }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export type RenderedEmail = { subject: string; text: string; html: string; headers: Array<{ Name: string; Value: string }> }

/** The shared frame: brand line, body, and the topic's unsubscribe footer. */
export function emailFrame(input: { siteUrl: string; emailId: string; topic: RankingEmailTopic; bodyHtml: string; footer: string }) {
  const links = rankingUnsubscribeLinks(input.siteUrl, input.emailId)
  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">${input.bodyHtml}</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">${escapeHtml(input.footer)} <a href="${escapeHtml(links.page)}" style="color:#607481">Turn off ${escapeHtml(RANKING_EMAIL_TOPIC_LABELS[input.topic])}</a> · <a href="${escapeHtml(links.settings)}" style="color:#607481">Email settings</a></div>
</div></body></html>`
  const textFooter = `${input.footer} Turn off ${RANKING_EMAIL_TOPIC_LABELS[input.topic]}: ${links.page}\n\nOr choose your emails in Settings: ${links.settings}`
  const headers = [
    { Name: 'List-Unsubscribe', Value: `<${links.oneClick}>` },
    { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
  ]
  return { html, textFooter, headers }
}

export function jobAlertEmail(input: { emailId: string; payload: JobAlertEmailPayload; siteUrl?: string }): RenderedEmail {
  const siteUrl = rankingEmailSiteUrl(input.siteUrl)
  const { payload } = input
  const count = payload.jobs.length
  const prefix = payload.test ? '[Test] ' : ''
  const subject = count
    ? `${prefix}${count} new job${count === 1 ? '' : 's'} for “${payload.alertName}”`
    : `${prefix}No new jobs for “${payload.alertName}” right now`
  const intro = count
    ? `${count} new job${count === 1 ? '' : 's'} match your alert “${payload.alertName}” and your profile.`
    : `No new jobs match your alert “${payload.alertName}” right now. (Test email: real alerts are only sent when something new matches.)`
  const rows = payload.jobs.map((job) => {
    const url = `${siteUrl}/jobs/${encodeURIComponent(job.id)}?src=job_alert`
    const meta = [job.companyName, job.location].filter(Boolean).join(' · ')
    return {
      text: `${job.title}\n${meta}\n${job.label}\n${url}`,
      html: `<tr><td style="padding:12px 0;border-top:1px solid #e3ecef"><a href="${escapeHtml(url)}" style="color:#075e82;font-weight:bold;font-size:15px;text-decoration:none">${escapeHtml(job.title)}</a><div style="font-size:13px;color:#4a6170;margin-top:2px">${escapeHtml(meta)}</div><div style="font-size:12px;color:#0b6b4f;font-weight:bold;margin-top:4px">${escapeHtml(job.label)}</div></td></tr>`,
    }
  })
  const alertsUrl = `${siteUrl}/jobs/alerts?src=job_alert`
  const footer = 'You get this email because you set up a job alert on Sea N Shore.'
  const frame = emailFrame({
    siteUrl,
    emailId: input.emailId,
    topic: 'job_alerts',
    footer,
    bodyHtml: `<p style="margin:0 0 12px;font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
${rows.length ? `<table role="presentation" style="width:100%;border-collapse:collapse">${rows.map((row) => row.html).join('')}</table>` : ''}
<p style="margin:20px 0 0"><a href="${escapeHtml(alertsUrl)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Manage job alerts</a></p>`,
  })
  return {
    subject,
    text: [intro, ...rows.map((row) => row.text), `Manage job alerts: ${alertsUrl}`, frame.textFooter].join('\n\n'),
    html: frame.html,
    headers: frame.headers,
  }
}

type DigestEmailPayload = import('./weekly-digest').DigestPayload

/** Round G (G6): the weekly digest. Text and links only (no images, no tracking pixel); every link carries ?src=digest. */
export function weeklyDigestEmail(input: { emailId: string; payload: DigestEmailPayload; siteUrl?: string }): RenderedEmail {
  const siteUrl = rankingEmailSiteUrl(input.siteUrl)
  const { payload } = input
  const link = (path: string) => `${siteUrl}${path}${path.includes('?') ? '&' : '?'}src=digest`
  const sections: Array<{ title: string; items: Array<{ text: string; meta?: string | null; url: string }> }> = [
    { title: 'Posts you haven’t seen', items: payload.posts.map((post) => ({ text: post.firstLine, meta: post.authorName, url: link(`/posts/${encodeURIComponent(post.id)}`) })) },
    { title: 'Jobs for you', items: payload.jobs.map((job) => ({ text: job.title, meta: `${job.companyName} · ${job.label}`, url: link(`/jobs/${encodeURIComponent(job.id)}`) })) },
    { title: 'People you may know', items: payload.people.map((person) => ({ text: person.name, meta: person.reason ?? person.headline, url: link(`/people/${encodeURIComponent(person.slug)}`) })) },
    { title: 'Events', items: payload.events.map((event) => ({ text: event.title, meta: event.when, url: link(`/events/${encodeURIComponent(event.id)}`) })) },
    { title: 'A course for you', items: payload.courses.map((course) => ({ text: course.title, meta: course.reason, url: link(`/learn/courses/${encodeURIComponent(course.slug)}`) })) },
  ].filter((section) => section.items.length)
  const prefix = payload.test ? '[Test] ' : ''
  const subject = `${prefix}Your week on Sea N Shore`
  const footer = 'You get this weekly summary because you are a Sea N Shore member.'
  const frame = emailFrame({
    siteUrl,
    emailId: input.emailId,
    topic: 'weekly_digest',
    footer,
    bodyHtml: `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Here is what is new for you this week.</p>
${sections.map((section) => `<h2 style="margin:20px 0 8px;font-size:15px;color:#071b2d">${escapeHtml(section.title)}</h2>
<table role="presentation" style="width:100%;border-collapse:collapse">${section.items.map((item) => `<tr><td style="padding:8px 0;border-top:1px solid #e3ecef"><a href="${escapeHtml(item.url)}" style="color:#075e82;font-weight:bold;text-decoration:none">${escapeHtml(item.text)}</a>${item.meta ? `<div style="font-size:13px;color:#4a6170;margin-top:2px">${escapeHtml(item.meta)}</div>` : ''}</td></tr>`).join('')}</table>`).join('\n')}
<p style="margin:24px 0 0"><a href="${escapeHtml(link('/home'))}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Open Sea N Shore</a></p>`,
  })
  const text = [
    'Here is what is new for you this week.',
    ...sections.map((section) => [section.title.toUpperCase(), ...section.items.map((item) => `${item.text}${item.meta ? ` (${item.meta})` : ''}\n${item.url}`)].join('\n\n')),
    `Open Sea N Shore: ${link('/home')}`,
    frame.textFooter,
  ].join('\n\n')
  return { subject, text, html: frame.html, headers: frame.headers }
}

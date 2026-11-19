import type { OrganizationReviewNoticeDetails } from './organization-review-notice'

/**
 * Round GP (Global Partners), Part C: the email an organization's applicant gets when its verification is approved,
 * rejected or sent back for changes. Plain and short; a rejection or a request for changes includes the reviewer's
 * reason. Every link is built from the site address setting (NEXT_PUBLIC_SITE_URL), never a fixed domain. Kept free
 * of web-only imports: the outbox worker renders it.
 */
export const ORGANIZATION_REVIEW_EMAIL_FROM = 'Sea N Shore <organizations@mail.seanshore.in>'

export type RenderedOrganizationReviewEmail = { subject: string; text: string; html: string }

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A subject or name can never carry a line break into a header. */
function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** The site address setting, without a trailing slash; null when it is missing or not an http(s) address. */
export function organizationReviewSiteUrl(value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL) {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : null
}

export function renderOrganizationReviewEmail(input: { details: OrganizationReviewNoticeDetails; siteUrl: string }): RenderedOrganizationReviewEmail {
  const name = oneLine(input.details.companyName) || 'your organization'
  const reason = input.details.reason?.trim() || null
  const pageLink = input.details.companySlug
    ? `${input.siteUrl}/organizations/${encodeURIComponent(input.details.companySlug)}`
    : `${input.siteUrl}/organizations`
  const applicationLink = `${input.siteUrl}/organizations#update-application`

  const copy = input.details.decision === 'approved'
    ? {
      subject: `${name} is verified on Sea N Shore`,
      lead: `Good news: Sea N Shore has verified ${name}. Its page is now public, and its owners and administrators can post jobs, events and courses for it.`,
      link: pageLink,
      linkLabel: 'Open the organization page',
    }
    : input.details.decision === 'rejected'
      ? {
        subject: `${name} was not verified`,
        lead: `Sea N Shore could not verify ${name} from the details you sent.`,
        link: applicationLink,
        linkLabel: 'Review and resubmit',
      }
      : {
        subject: `Changes needed to verify ${name}`,
        lead: `Sea N Shore needs a few changes before it can verify ${name}.`,
        link: applicationLink,
        linkLabel: 'Update your application',
      }

  const text = [
    copy.lead,
    ...(reason ? ['', 'The reviewer wrote:', reason] : []),
    '',
    `${copy.linkLabel}: ${copy.link}`,
    '',
    'You get this email because you asked Sea N Shore to verify this organization.',
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(copy.lead)}</p>
${reason ? `<p style="margin:16px 0 4px;font-weight:bold">The reviewer wrote:</p><p style="margin:0 0 12px;line-height:1.6;white-space:pre-wrap">${escapeHtml(reason)}</p>` : ''}
<p style="margin:20px 0 0"><a href="${escapeHtml(copy.link)}" style="display:inline-block;background:#0b5c7a;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:8px">${escapeHtml(copy.linkLabel)}</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">You get this email because you asked Sea N Shore to verify this organization.</div>
</div></body></html>`

  return { subject: oneLine(copy.subject), text, html }
}

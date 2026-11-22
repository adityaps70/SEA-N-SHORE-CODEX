import { createResendEmailClient, loadResendApiKey, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { DEFAULT_PUBLIC_SITE_URL } from '@/config/public-site'
import { ACCOUNT_EMAIL_FROM } from './security-emails'

/**
 * Admin two-step: the security emails a member gets when their authenticator app is replaced, or when a Sea N Shore
 * administrator resets their two-step verification. Sent straight away (best effort, once: the idempotency key is the
 * audit event), so the member hears at once; a failed send is logged by code only and never undoes the change.
 */
export type AuthenticatorNoticeKind = 'replaced' | 'reset_by_admin'

type Sender = Pick<ResendEmailClient, 'sendEmail'>

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function authenticatorNotice(kind: AuthenticatorNoticeKind, siteUrl: string = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL) {
  const site = siteUrl.trim().replace(/\/+$/, '')
  const support = `${site}/contact`
  const security = `${site}/settings/security`
  const copy = kind === 'replaced'
    ? {
      subject: 'Your Sea N Shore authenticator app was changed',
      lead: 'The authenticator app on your Sea N Shore account was replaced with a new one. Your other devices were signed out.',
    }
    : {
      subject: 'Sea N Shore reset your two-step verification',
      lead: 'A Sea N Shore administrator reset the two-step verification on your account, and every device was signed out. Sign in with your password, then set up an authenticator app again.',
    }
  const warning = 'If this wasn’t you, contact support straight away.'
  return {
    subject: copy.subject,
    text: [copy.lead, `Two-step verification: ${security}`, `${warning} ${support}`, 'You get this email because it is the address on your Sea N Shore account.'].join('\n\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${escapeHtml(copy.lead)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(warning)}</p>
<p style="margin:0"><a href="${escapeHtml(security)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Two-step verification</a></p>
<p style="margin:16px 0 0"><a href="${escapeHtml(support)}" style="color:#075e82">Contact support</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">You get this email because it is the address on your Sea N Shore account.</div>
</div></body></html>`,
  }
}

/** Sends the notice. Returns false (and logs the code only) when it could not be sent; the change stands. */
export async function sendAuthenticatorNotice(input: {
  kind: AuthenticatorNoticeKind
  to: string | null
  idempotencyKey: string
  sender?: Sender | null
}): Promise<boolean> {
  if (!input.to) return false
  try {
    let sender = input.sender
    if (sender === undefined) {
      const key = await loadResendApiKey()
      sender = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    }
    if (!sender) return false
    const email = authenticatorNotice(input.kind)
    await sender.sendEmail({
      from: ACCOUNT_EMAIL_FROM,
      to: input.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: input.idempotencyKey,
      tags: [{ name: 'category', value: `authenticator_${input.kind}` }],
    })
    return true
  } catch (error) {
    console.warn('[authenticator_notice_failed]', { kind: input.kind, code: error instanceof Error ? error.name.slice(0, 60) : 'unknown' })
    return false
  }
}

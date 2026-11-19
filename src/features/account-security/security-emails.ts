import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import type { AccountQuery, AccountTransaction } from './types'
import { DEFAULT_PUBLIC_SITE_URL } from '@/config/public-site'

/**
 * Round H (H3): account security notices, queued in public.account_security_emails and sent by the outbox worker
 * (scripts/workers/publish-outbox.ts) through Resend, like the app's other emails. Today there is one: after an
 * email change, the OLD address is told the account's email changed, with the new address masked
 * (n***@example.com). The recipient is cleared from the row once it is finished, and logs carry counts only.
 */

export const ACCOUNT_EMAIL_FROM = 'Sea N Shore <accounts@mail.seanshore.in>'
const MAX_ATTEMPTS = 5

type Sender = Pick<ResendEmailClient, 'sendEmail'>

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function siteUrlOf(siteUrl?: string) {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).trim().replace(/\/+$/, '')
}

export function emailChangedNotice(input: { maskedNewEmail: string; siteUrl?: string }) {
  const siteUrl = siteUrlOf(input.siteUrl)
  const support = `${siteUrl}/contact`
  const message = `Your Sea N Shore email was changed to ${input.maskedNewEmail}.`
  const warning = 'If this wasn’t you, contact support straight away.'
  return {
    subject: 'Your Sea N Shore email address was changed',
    text: [message, `${warning} ${support}`, 'You get this email because it was the address on your Sea N Shore account.'].join('\n\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${escapeHtml(message)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(warning)}</p>
<p style="margin:0"><a href="${escapeHtml(support)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Contact support</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">You get this email because it was the address on your Sea N Shore account.</div>
</div></body></html>`,
  }
}

/** Queues the notice to the old address. Called in the same transaction that records the change. */
export async function queueEmailChangedNotice(query: AccountQuery, input: { profileId: string; oldEmail: string; maskedNewEmail: string }) {
  await query(
    `insert into public.account_security_emails (profile_id, kind, recipient_email, payload)
     values ($1, 'email_changed', $2, jsonb_build_object('maskedNewEmail', $3::text))`,
    [input.profileId, input.oldEmail.trim().toLowerCase(), input.maskedNewEmail],
  )
}

type Delivery = { id: string; recipient: string | null; maskedNewEmail: string | null }

export function createAccountSecurityEmailRepository(input: { query: AccountQuery; transaction: AccountTransaction }) {
  return {
    /** Claims due notices with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<Delivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return input.transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select id from public.account_security_emails
             where status = 'pending' and next_attempt_at <= now() and attempts < $2
             order by next_attempt_at asc, id asc
             for update skip locked
             limit $1
           )
           update public.account_security_emails email
           set attempts = email.attempts + 1, next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning email.id, email.recipient_email, email.payload ->> 'maskedNewEmail' as masked_new_email`,
          [bounded, MAX_ATTEMPTS],
        )
        return rows.map((row) => ({
          id: String(row.id),
          recipient: (row.recipient_email as string | null) ?? null,
          maskedNewEmail: (row.masked_new_email as string | null) ?? null,
        }))
      })
    },

    async markSent(id: string, messageId: string) {
      await input.query(
        `update public.account_security_emails
         set status = 'sent', sent_at = now(), last_error = null, recipient_email = null,
             payload = payload || jsonb_build_object('messageId', $2::text)
         where id = $1`,
        [id, messageId],
      )
    },

    async markSkipped(id: string, reason: string) {
      await input.query(
        `update public.account_security_emails set status = 'skipped', last_error = left($2, 500), recipient_email = null where id = $1`,
        [id, reason],
      )
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await input.query(
        `update public.account_security_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             recipient_email = case when $3 and attempts < $4 then recipient_email else null end,
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1`,
        [id, error, retryable, MAX_ATTEMPTS],
      )
    },
  }
}

function errorText(error: unknown) {
  if (error instanceof ResendApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  return error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
}

export function createAccountSecurityEmailWorker(input: {
  repository: ReturnType<typeof createAccountSecurityEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
}) {
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  return {
    async runSweep(limit = 10) {
      const sender = await resolveClient()
      if (!sender) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await input.repository.claimBatch(limit)
      const counts = { claimed: deliveries.length, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: false }
      for (const delivery of deliveries) {
        if (!delivery.recipient || !delivery.maskedNewEmail) {
          await input.repository.markSkipped(delivery.id, 'incomplete')
          counts.skipped += 1
          continue
        }
        const email = emailChangedNotice({ maskedNewEmail: delivery.maskedNewEmail, siteUrl: input.siteUrl })
        try {
          const result = await sender.sendEmail({
            from: ACCOUNT_EMAIL_FROM,
            to: delivery.recipient,
            subject: email.subject,
            text: email.text,
            html: email.html,
            idempotencyKey: `account-security/${delivery.id}`,
            tags: [{ name: 'category', value: 'account_email_changed' }],
          })
          await input.repository.markSent(delivery.id, result.messageId)
          counts.sent += 1
        } catch (error) {
          const retryable = error instanceof ResendApiError && error.retryable
          await input.repository.markFailed(delivery.id, errorText(error), retryable)
          if (retryable) {
            counts.retrying += 1
            break
          }
          counts.failed += 1
        }
      }
      return counts
    },
  }
}

import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { LEARNING_EMAIL_FROM, learningEmailSiteUrl } from '../learning-email'
import { consentWording, INVITATION_DAYS } from './crew-rules'

/**
 * Company training invitation emails (round D, part 3). The outbox worker sends one email per open invitation (the
 * Resend idempotency key is the invitation id), like the round C course invitations. The link opens the invitation
 * page, which asks a person without an account to join Sea N Shore with this address first.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

const MAX_ATTEMPTS = 5

export type CompanyInvitationDelivery = { id: string; email: string; companyName: string; inviterName: string; isMember: boolean }

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function companyInvitationEmail(input: { id: string; companyName: string; inviterName: string; isMember: boolean; siteUrl?: string }) {
  const siteUrl = learningEmailSiteUrl(input.siteUrl)
  const invitationUrl = `${siteUrl}/learn/company-invitations/${encodeURIComponent(input.id)}`
  const signUpUrl = `${siteUrl}/auth/sign-up`
  const wording = consentWording(input.companyName)
  const message = `${input.inviterName} has invited you to ${input.companyName}'s crew training on Sea N Shore.`
  const how = input.isMember
    ? `Open the invitation to accept or decline. It is open for ${INVITATION_DAYS} days.`
    : `Create your free Sea N Shore account with this email address, then open the invitation to accept or decline. It is open for ${INVITATION_DAYS} days.`
  const actionUrl = input.isMember ? invitationUrl : signUpUrl
  const actionLabel = input.isMember ? 'Open the invitation' : 'Create my account'
  const text = [
    message,
    wording.summary,
    how,
    `${actionLabel}: ${actionUrl}`,
    ...(input.isMember ? [] : [`Then open the invitation: ${invitationUrl}`]),
    'If you were not expecting this, you can ignore this email.',
  ].join('\n\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:16px;line-height:1.6">${escapeHtml(message)}</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#33505f">${escapeHtml(wording.summary)}</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#33505f">${escapeHtml(how)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${escapeHtml(actionLabel)}</a></p>
${input.isMember ? '' : `<p style="margin:0;font-size:13px"><a href="${escapeHtml(invitationUrl)}" style="color:#075e82">Open the invitation after signing up</a></p>`}
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">If you were not expecting this, you can ignore this email.</div>
</div></body></html>`
  return { subject: `${input.companyName} invited you to its crew training on Sea N Shore`, text, html }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return withTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

export function createCompanyInvitationEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  return {
    /** Claims due invitation emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<CompanyInvitationDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select invitation.id
             from public.company_training_invitations invitation
             where invitation.status = 'pending' and invitation.email_status = 'pending'
               and invitation.expires_at > now() and invitation.next_attempt_at <= now()
               and invitation.email_attempts < $2
             order by invitation.next_attempt_at asc, invitation.id asc
             for update skip locked
             limit $1
           )
           update public.company_training_invitations invitation
           set email_attempts = invitation.email_attempts + 1, next_attempt_at = now() + interval '15 minutes', updated_at = now()
           from picked
           where invitation.id = picked.id
           returning invitation.id, invitation.email,
             (select company.name from public.companies company where company.id = invitation.company_id) as company_name,
             (select profile.full_name from public.profiles profile where profile.id = invitation.invited_by) as inviter_name,
             exists (select 1 from public.identity_accounts account
                     where lower(account.email) = invitation.email and account.email_verified = true) as is_member`,
          [bounded, MAX_ATTEMPTS],
        )
        return rows.map((row) => ({
          id: String(row.id),
          email: String(row.email),
          companyName: String(row.company_name ?? '').trim() || 'A Sea N Shore organization',
          inviterName: String(row.inviter_name ?? '').trim() || 'A training manager',
          isMember: Boolean(row.is_member),
        }))
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.company_training_invitations set email_status = 'sent', resend_message_id = $2, updated_at = now() where id = $1::uuid`,
        [id, messageId],
      )
    },

    async markFailed(id: string, retryable: boolean) {
      await queryRows(
        `update public.company_training_invitations
         set email_status = case when $2 and email_attempts < $3 then 'pending' else 'failed' end,
             next_attempt_at = case when $2 and email_attempts < $3 then now() + make_interval(mins => greatest(5, email_attempts * 10)) else next_attempt_at end,
             updated_at = now()
         where id = $1::uuid`,
        [id, retryable, MAX_ATTEMPTS],
      )
    },
  }
}

export function createCompanyInvitationWorker(input: {
  repository?: ReturnType<typeof createCompanyInvitationEmailRepository>
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? createCompanyInvitationEmailRepository()
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
      if (!sender) return { claimed: 0, sent: 0, failed: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, retrying: 0 }
      for (const delivery of deliveries) {
        const email = companyInvitationEmail({ ...delivery, siteUrl: input.siteUrl })
        try {
          const result = await sender.sendEmail({
            from: LEARNING_EMAIL_FROM,
            to: delivery.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
            idempotencyKey: `company-training-invitation/${delivery.id}`,
            tags: [{ name: 'category', value: 'company_training_invitation' }],
          })
          await repository.markSent(delivery.id, result.messageId)
          counts.sent += 1
        } catch (error) {
          const retryable = error instanceof ResendApiError && error.retryable
          await repository.markFailed(delivery.id, retryable)
          if (retryable) {
            counts.retrying += 1
            break
          }
          counts.failed += 1
        }
      }
      return { claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}

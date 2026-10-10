import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { courseInvitationClaims } from './course-roster-repository'
import { LEARNING_EMAIL_FROM, learningEmailSiteUrl } from './learning-email'

/**
 * Course invitations (learning round C, C1): a trainer added someone by email who is not a Sea N Shore member yet.
 * The outbox worker first enrols anyone who has since signed up with that address, then sends one invitation email
 * per pending invitation (the Resend idempotency key is the invitation id).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

const MAX_ATTEMPTS = 5

export type CourseInvitationDelivery = { id: string; email: string; courseTitle: string; courseSlug: string; inviterName: string }

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function courseInvitationEmail(input: { courseTitle: string; courseSlug: string; inviterName: string; siteUrl?: string }) {
  const siteUrl = learningEmailSiteUrl(input.siteUrl)
  const signUpUrl = `${siteUrl}/auth/sign-up`
  const courseUrl = `${siteUrl}/learn/courses/${encodeURIComponent(input.courseSlug)}`
  const message = `${input.inviterName} has added you to the course "${input.courseTitle}" on Sea N Shore.`
  const how = 'Create your free Sea N Shore account with this email address and the course will be waiting in My Learning. The invitation is open for 60 days.'
  const text = [message, how, `Create your account: ${signUpUrl}`, `About the course: ${courseUrl}`, 'If you were not expecting this, you can ignore this email.'].join('\n\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:16px;line-height:1.6">${escapeHtml(message)}</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#33505f">${escapeHtml(how)}</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(signUpUrl)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Create my account</a></p>
<p style="margin:0;font-size:13px"><a href="${escapeHtml(courseUrl)}" style="color:#075e82">About the course</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">If you were not expecting this, you can ignore this email.</div>
</div></body></html>`
  return { subject: `You're invited to ${input.courseTitle} on Sea N Shore`, text, html }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return withTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

export function createCourseInvitationEmailRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction
  return {
    /** Claims due invitation emails with a 15-minute lease, so a crashed send is retried and never doubled. */
    async claimBatch(limit = 10): Promise<CourseInvitationDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (query) => {
        const rows = await query(
          `with picked as (
             select invitation.id
             from public.learning_course_invitations invitation
             where invitation.status = 'pending' and invitation.email_status = 'pending'
               and invitation.expires_at > now() and invitation.next_attempt_at <= now()
               and invitation.email_attempts < $2
             order by invitation.next_attempt_at asc, invitation.id asc
             for update skip locked
             limit $1
           )
           update public.learning_course_invitations invitation
           set email_attempts = invitation.email_attempts + 1, next_attempt_at = now() + interval '15 minutes', updated_at = now()
           from picked
           where invitation.id = picked.id
           returning invitation.id, invitation.email,
             (select course.title from public.learning_courses course where course.id = invitation.course_id) as course_title,
             (select course.slug from public.learning_courses course where course.id = invitation.course_id) as course_slug,
             (select profile.full_name from public.profiles profile where profile.id = invitation.invited_by) as inviter_name`,
          [bounded, MAX_ATTEMPTS],
        )
        return rows.map((row) => ({
          id: String(row.id),
          email: String(row.email),
          courseTitle: String(row.course_title ?? ''),
          courseSlug: String(row.course_slug ?? ''),
          inviterName: String(row.inviter_name ?? '').trim() || 'A Sea N Shore trainer',
        }))
      })
    },

    async markSent(id: string, messageId: string) {
      await queryRows(
        `update public.learning_course_invitations set email_status = 'sent', resend_message_id = $2, updated_at = now() where id = $1::uuid`,
        [id, messageId],
      )
    },

    async markFailed(id: string, retryable: boolean) {
      await queryRows(
        `update public.learning_course_invitations
         set email_status = case when $2 and email_attempts < $3 then 'pending' else 'failed' end,
             next_attempt_at = case when $2 and email_attempts < $3 then now() + make_interval(mins => greatest(5, email_attempts * 10)) else next_attempt_at end,
             updated_at = now()
         where id = $1::uuid`,
        [id, retryable, MAX_ATTEMPTS],
      )
    },
  }
}

export function createCourseInvitationWorker(input: {
  repository?: ReturnType<typeof createCourseInvitationEmailRepository>
  claims?: { sweep: (limit?: number) => Promise<number> }
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
} = {}) {
  const repository = input.repository ?? createCourseInvitationEmailRepository()
  const claims = input.claims ?? courseInvitationClaims
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  return {
    async runSweep(limit = 10) {
      // People who signed up with an invited address are enrolled first, so they get no invitation email.
      const enrolled = await claims.sweep(50)
      const sender = await resolveClient()
      if (!sender) return { enrolled, claimed: 0, sent: 0, failed: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, retrying: 0 }
      for (const delivery of deliveries) {
        const email = courseInvitationEmail({ ...delivery, siteUrl: input.siteUrl })
        try {
          const result = await sender.sendEmail({
            from: LEARNING_EMAIL_FROM,
            to: delivery.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
            idempotencyKey: `learning-course-invitation/${delivery.id}`,
            tags: [{ name: 'category', value: 'learning_course_invitation' }],
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
      return { enrolled, claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}
